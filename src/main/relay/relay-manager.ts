import { EventEmitter } from 'events'
import { statSync } from 'fs'
import { join } from 'path'
import type {
  RelayInboxItem,
  RelayItem,
  RelayLogEntry,
  RelayQueueReason,
  RelayRequest,
  RelaySendResult,
  RelayState,
} from './types'
import {
  formatNudge,
  hubRootOfOutboundPath,
  isUnderIntegrationOutbound,
  sanitizeFromName,
  sanitizeSubject,
} from './validation'

// Orchestrates relay sends: validate → resolve target → deliver when idle,
// queue otherwise. Delivery is stage-only: the nudge is written to the target
// pty WITHOUT a trailing \r, so it sits in the composer until a human (or the
// session's own next interaction) submits it. Every outcome is logged and
// emitted — sessions never whisper to each other invisibly.

export interface RelaySessionInfo {
  id: string
  name: string
  projectPath?: string
}

export interface RelayManagerDeps {
  listSessions: () => RelaySessionInfo[]
  isIdle: (terminalId: string) => boolean
  // Serialized staged write into the target pty (no trailing \r in data).
  writeStaged: (terminalId: string, data: string) => Promise<void>
  store: { load(): RelayState; save(state: RelayState): void }
  // Auto-submit opt-in (phase 3): when this returns true for the target —
  // wired to "an autopilot is attached and sits at a WAITING checkpoint" —
  // delivery appends the submit \r. Everything else stays stage-only.
  canAutoSubmit?: (terminalId: string) => boolean
  // Injectable for tests.
  isFile?: (path: string) => boolean
  isDir?: (path: string) => boolean
  now?: () => number
}

// Loop guard: autonomous sessions could ping-pong relays forever. A flat
// N-per-hour cap conflated two different traffic shapes — a runaway loop and
// a legitimate burst (a replay sweep announcing six related threads at once)
// look identical to it, and the burst is what actually showed up in practice.
// So: token bucket. BURST_CAPACITY sends may go out back-to-back, then one
// token returns every REFILL_INTERVAL_MS, giving the same long-run ceiling a
// sustained ping-pong would have hit. Hitting empty refuses loudly (toast via
// the refusal log entry), never drops silently.
//
// The bucket is derived from the log rather than stored, so it needs no schema
// change and no timer: replay the pair's accepted sends in order, refilling
// between them. Refusals are not sends and cost nothing.
// Queued nudges whose target never appears eventually stop being pending mail
// and start being clutter (observed: sends from a decommissioned session name
// sitting queued for 11 days). They expire with a log entry instead.
const QUEUE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

const BURST_CAPACITY = 10
const SUSTAINED_PER_HOUR = 6
const REFILL_INTERVAL_MS = (60 * 60 * 1000) / SUSTAINED_PER_HOUR
// How far back to replay. Anything older has long since refilled the bucket.
const BUCKET_LOOKBACK_MS = 24 * 60 * 60 * 1000

function defaultIsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function defaultIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

type TargetResolution =
  | { kind: 'resolved'; id: string }
  | { kind: 'unknown' }
  | { kind: 'ambiguous' }

export class RelayManager extends EventEmitter {
  private queue: RelayItem[]
  private log: RelayLogEntry[]
  private inbox: RelayInboxItem[]
  private isFile: (path: string) => boolean
  private isDir: (path: string) => boolean
  private now: () => number
  private idCounter = 0
  private draining = false

  constructor(private deps: RelayManagerDeps) {
    super()
    const persisted = deps.store.load()
    this.queue = persisted.queue
    this.log = persisted.log
    this.inbox = persisted.inbox ?? []
    this.isFile = deps.isFile ?? defaultIsFile
    this.isDir = deps.isDir ?? defaultIsDir
    this.now = deps.now ?? Date.now
  }

  getState(): RelayState {
    return { queue: [...this.queue], log: [...this.log], inbox: [...this.inbox] }
  }

  async send(req: RelayRequest): Promise<RelaySendResult> {
    const id = this.nextId()
    const from = sanitizeFromName(req.from)
    const subject = sanitizeSubject(req.subject)
    const path = (req.path ?? '').trim()
    const to = (req.to ?? '').trim()

    const refusal = this.validate(from, to, subject, path) ?? this.checkRateLimit(from, to)
    if (refusal) {
      this.appendLog({ id, ts: this.now(), from, to, subject, path, status: 'refused', detail: refusal })
      this.persistAndEmit()
      return { ok: false, status: 'refused', id, error: refusal }
    }

    const resolution = this.resolveTarget(to)
    if (resolution.kind !== 'resolved') {
      const reason: RelayQueueReason = resolution.kind === 'unknown' ? 'unknown-target' : 'ambiguous-target'
      return this.enqueue({ id, from, to, subject, path, createdAt: this.now(), reason })
    }
    const item: RelayItem = { id, from, to, subject, path, createdAt: this.now(), reason: 'busy' }
    // Auto-submit targets (autopilot at a WAITING checkpoint) still get pty
    // injection and therefore still respect idleness. Everyone else gets the
    // inbox — which is always deliverable, busy or not: nothing touches the
    // composer until the human stages it.
    if (this.deps.canAutoSubmit?.(resolution.id)) {
      if (!this.deps.isIdle(resolution.id)) return this.enqueue(item)
      return this.deliver(item, resolution.id)
    }
    return this.deliverToInbox(item, resolution.id)
  }

  cancel(id: string): boolean {
    const index = this.queue.findIndex((item) => item.id === id)
    if (index === -1) return false
    const [item] = this.queue.splice(index, 1)
    this.appendLog({
      id: item.id, ts: this.now(), from: item.from, to: item.to,
      subject: item.subject, path: item.path, status: 'cancelled',
    })
    this.persistAndEmit()
    return true
  }

  // Called at 1 Hz from the main process: deliver queued relays whose target
  // is now resolvable and idle. Serialized so a slow pty write can't overlap
  // the next tick.
  async tick(): Promise<void> {
    if (this.draining || this.queue.length === 0) return
    this.draining = true
    try {
      const remaining: RelayItem[] = []
      let changed = false
      // At most one nudge per target per tick. Nudges carry no trailing
      // newline, so two delivered back-to-back concatenate into a single
      // unreadable composer line — and the idle check can't catch it, since
      // the echo of the first write hasn't reached us yet when the second is
      // evaluated. The next tick delivers the next one.
      const deliveredTo = new Set<string>()
      for (const item of this.queue) {
        if (this.now() - item.createdAt > QUEUE_EXPIRY_MS) {
          this.appendLog({
            id: item.id, ts: this.now(), from: item.from, to: item.to,
            subject: item.subject, path: item.path, status: 'cancelled', detail: 'expired after 7 days',
          })
          changed = true
          continue
        }
        const resolution = this.resolveTarget(item.to)
        if (resolution.kind === 'resolved' && !this.deps.canAutoSubmit?.(resolution.id)) {
          // Inbox targets deliver regardless of idleness, several per tick —
          // nothing is typed, so the pty-concatenation cap doesn't apply.
          this.deliverToInbox(item, resolution.id)
          changed = true
        } else if (resolution.kind === 'resolved' && deliveredTo.has(resolution.id)) {
          if (item.reason !== 'busy') { item.reason = 'busy'; changed = true }
          remaining.push(item)
        } else if (resolution.kind === 'resolved' && this.deps.isIdle(resolution.id)) {
          const delivered = await this.deliverQueued(item, resolution.id)
          if (delivered) { deliveredTo.add(resolution.id); changed = true }
          else remaining.push(item)
        } else {
          const reason: RelayQueueReason =
            resolution.kind === 'resolved' ? 'busy'
              : resolution.kind === 'unknown' ? 'unknown-target' : 'ambiguous-target'
          if (reason !== item.reason) { item.reason = reason; changed = true }
          remaining.push(item)
        }
      }
      this.queue = remaining
      if (changed) this.persistAndEmit()
    } finally {
      this.draining = false
    }
  }

  private validate(from: string, to: string, subject: string, path: string): string | null {
    if (!from) return 'sender name is empty after sanitization'
    if (!to) return 'no target session given'
    if (!subject) return 'subject is empty after sanitization'
    if (!path) return 'no document path given'
    if (!isUnderIntegrationOutbound(path) && !this.isHubOutboundPath(path)) {
      return 'path must be inside a repo\'s docs/integration/outbound/ or an exchange hub\'s outbound/'
    }
    if (!this.isFile(path)) return 'document does not exist (or is not a file)'
    return null
  }

  // 1.4.0 hub form: <hubRoot>/outbound/<file> where the root carries the hub
  // signature — a sibling inbound/ and a REPOS.md. Checked on disk so a stray
  // folder that merely happens to be named outbound/ doesn't qualify.
  private isHubOutboundPath(path: string): boolean {
    const root = hubRootOfOutboundPath(path)
    if (!root) return false
    return this.isDir(join(root, 'inbound')) && this.isFile(join(root, 'REPOS.md'))
  }

  // One accepted relay = one token, however many log entries it produced. A
  // queued relay that later delivers writes both a 'queued' and a 'delivered'
  // entry under the same id; counting rows instead of relays charged busy
  // targets double.
  private acceptedSendTimes(from: string, to: string, since: number): number[] {
    const fromKey = from.toLowerCase()
    const toKey = to.toLowerCase()
    const earliestById = new Map<string, number>()
    for (const entry of this.log) {
      if (entry.ts < since) continue
      if (entry.status !== 'delivered' && entry.status !== 'queued') continue
      if (entry.from.toLowerCase() !== fromKey || entry.to.toLowerCase() !== toKey) continue
      const seen = earliestById.get(entry.id)
      if (seen === undefined || entry.ts < seen) earliestById.set(entry.id, entry.ts)
    }
    return [...earliestById.values()].sort((a, b) => a - b)
  }

  private checkRateLimit(from: string, to: string): string | null {
    const now = this.now()
    const sends = this.acceptedSendTimes(from, to, now - BUCKET_LOOKBACK_MS)

    let tokens = BURST_CAPACITY
    let last = sends.length > 0 ? sends[0] : now
    for (const ts of sends) {
      tokens = Math.min(BURST_CAPACITY, tokens + (ts - last) / REFILL_INTERVAL_MS)
      tokens -= 1
      last = ts
    }
    tokens = Math.min(BURST_CAPACITY, tokens + (now - last) / REFILL_INTERVAL_MS)

    if (tokens < 1) {
      const waitMs = Math.max(0, Math.ceil((1 - tokens) * REFILL_INTERVAL_MS))
      const waitMin = Math.max(1, Math.round(waitMs / 60000))
      return `rate limit: burst of ${BURST_CAPACITY} spent from "${from}" to "${to}" ` +
        `(refills ${SUSTAINED_PER_HOUR}/hour) — next slot in ~${waitMin} min, or intervene manually`
    }
    return null
  }

  private resolveTarget(to: string): TargetResolution {
    const sessions = this.deps.listSessions()
    const byId = sessions.find((s) => s.id === to)
    if (byId) return { kind: 'resolved', id: byId.id }
    const needle = to.toLowerCase()
    const byName = sessions.filter((s) => s.name.toLowerCase() === needle)
    if (byName.length === 1) return { kind: 'resolved', id: byName[0].id }
    if (byName.length > 1) return { kind: 'ambiguous' }
    return { kind: 'unknown' }
  }

  private enqueue(item: RelayItem): RelaySendResult {
    this.queue.push(item)
    this.appendLog({
      id: item.id, ts: this.now(), from: item.from, to: item.to,
      subject: item.subject, path: item.path, status: 'queued', detail: item.reason,
    })
    this.persistAndEmit()
    return { ok: true, status: 'queued', id: item.id }
  }

  private nudgeFor(item: RelayItem, terminalId: string): string {
    const nudge = formatNudge(item.from, item.subject, item.path)
    // Stage-only unless the host explicitly says this target may auto-submit
    // (autopilot attached, WAITING checkpoint). QueuedPtyWriter separates a
    // trailing \r into its own delayed chunk, mirroring the orchestrator path.
    return this.deps.canAutoSubmit?.(terminalId) ? `${nudge}\r` : nudge
  }

  private async deliver(item: RelayItem, terminalId: string): Promise<RelaySendResult> {
    const nudge = this.nudgeFor(item, terminalId)
    try {
      await this.deps.writeStaged(terminalId, nudge)
    } catch {
      // Pty died mid-write — queue instead of dropping.
      item.reason = 'busy'
      return this.enqueue(item)
    }
    this.appendLog({
      id: item.id, ts: this.now(), from: item.from, to: item.to,
      subject: item.subject, path: item.path, status: 'delivered', terminalId,
    })
    this.persistAndEmit()
    return { ok: true, status: 'delivered', id: item.id }
  }

  private async deliverQueued(item: RelayItem, terminalId: string): Promise<boolean> {
    const nudge = this.nudgeFor(item, terminalId)
    try {
      await this.deps.writeStaged(terminalId, nudge)
    } catch {
      return false // pty died mid-write — caller keeps the item queued
    }
    this.appendLog({
      id: item.id, ts: this.now(), from: item.from, to: item.to,
      subject: item.subject, path: item.path, status: 'delivered', terminalId,
    })
    return true
  }

  // Envelope delivery: the nudge sits in the target session's inbox until a
  // human stages, opens, or dismisses it. This is what flashes the envelope.
  private deliverToInbox(item: RelayItem, terminalId: string): RelaySendResult {
    const projectPath = this.deps.listSessions().find((s) => s.id === terminalId)?.projectPath
    this.inbox.push({
      id: item.id, from: item.from, subject: item.subject, path: item.path,
      ts: this.now(), terminalId, projectPath, read: false,
    })
    this.appendLog({
      id: item.id, ts: this.now(), from: item.from, to: item.to,
      subject: item.subject, path: item.path, status: 'delivered', terminalId, detail: 'inbox',
    })
    this.persistAndEmit()
    return { ok: true, status: 'delivered', id: item.id }
  }

  // Stop the envelope flashing once the human has looked.
  inboxMarkRead(terminalId: string): void {
    let changed = false
    for (const n of this.inbox) {
      if (n.terminalId === terminalId && !n.read) { n.read = true; changed = true }
    }
    if (changed) this.persistAndEmit()
  }

  inboxDismiss(id: string): boolean {
    const index = this.inbox.findIndex((n) => n.id === id)
    if (index === -1) return false
    this.inbox.splice(index, 1)
    this.persistAndEmit()
    return true
  }

  // Human-initiated: put the nudge text into the composer now (the old
  // delivery behavior, on demand). The item leaves the inbox on success.
  async inboxStage(id: string): Promise<{ ok: boolean; error?: string }> {
    const item = this.inbox.find((n) => n.id === id)
    if (!item) return { ok: false, error: 'nudge no longer in inbox' }
    try {
      await this.deps.writeStaged(item.terminalId, formatNudge(item.from, item.subject, item.path))
    } catch {
      return { ok: false, error: 'session is gone — reopen it or dismiss the nudge' }
    }
    this.inbox = this.inbox.filter((n) => n.id !== id)
    this.persistAndEmit()
    return { ok: true }
  }

  private appendLog(entry: RelayLogEntry): void {
    this.log.push(entry)
  }

  private persistAndEmit(): void {
    this.deps.store.save({ queue: this.queue, log: this.log, inbox: this.inbox })
    // Re-read: save() may cap the log and inbox.
    const persisted = this.deps.store.load()
    this.log = persisted.log
    this.inbox = persisted.inbox ?? []
    this.emit('update', this.getState())
  }

  private nextId(): string {
    this.idCounter += 1
    return `relay-${this.now()}-${this.idCounter}`
  }
}
