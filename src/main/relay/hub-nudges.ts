// Cross-machine nudges over the exchange hubs (protocol 1.4.0). The relay's
// MCP server is loopback-only by design, so between machines the transport is
// the same as for every other exchange artifact: git. A cross-machine nudge is
// a tiny committed record in a hub's nudges/ folder; each CmdCLD instance
// polls the hub clones it holds, delivers records addressed to sessions it
// hosts into the local relay inbox, and commits a delivered marker back.
//
// Records are one file each and markers are separate files, so two machines
// never edit the same file and the worst race is a rebase on push. Delivery
// stays human-paced end to end: the receiving side lands in the inbox
// (flashing envelope), never in a composer.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hostname } from 'os'

const execFileP = promisify(execFile)

export const HUB_NUDGE_SCHEMA_VERSION = 1
const NUDGES_DIR = 'nudges'

export interface HubNudgeRecord {
  schemaVersion: typeof HUB_NUDGE_SCHEMA_VERSION
  id: string
  // "<session>@<machine>" — machine is the hostname that authored/should
  // receive it. A bare "<session>" target means any machine hosting that name.
  from: string
  to: string
  subject: string
  // Hub-relative document path ("outbound/<file>.md") — machine-independent;
  // each side resolves it against its own clone.
  path: string
  ts: number
}

export interface HubNudgeDeps {
  // Clone paths of the hubs this machine polls (from settings).
  hubClones: () => string[]
  // Hand a nudge to the local relay (inbox / queue). True = accepted locally,
  // so the hub record can be marked delivered.
  deliver: (n: { from: string; to: string; subject: string; path: string }) => Promise<boolean>
  listLocalSessionNames: () => string[]
  machine?: string
  now?: () => number
  log?: (msg: string) => void
}

export function splitTarget(to: string): { name: string; machine: string | null } {
  const at = to.lastIndexOf('@')
  if (at <= 0) return { name: to, machine: null }
  return { name: to.slice(0, at), machine: to.slice(at + 1) }
}

function isRecord(raw: unknown): raw is HubNudgeRecord {
  const r = raw as HubNudgeRecord
  return !!r && r.schemaVersion === HUB_NUDGE_SCHEMA_VERSION &&
    typeof r.id === 'string' && !!r.id &&
    typeof r.from === 'string' && typeof r.to === 'string' &&
    typeof r.subject === 'string' && typeof r.path === 'string' &&
    !r.path.includes('..') && r.path.length > 0
}

export class HubNudgeWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private machine: string
  private now: () => number

  constructor(private deps: HubNudgeDeps) {
    this.machine = deps.machine ?? hostname()
    this.now = deps.now ?? Date.now
  }

  start(intervalMs: number): void {
    this.stop()
    this.timer = setInterval(() => { void this.pollOnce() }, intervalMs)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private async git(clone: string, ...args: string[]): Promise<void> {
    await execFileP('git', args, { cwd: clone, windowsHide: true })
  }

  // One poll pass over every configured hub clone. Serialized: a slow git
  // operation never overlaps the next tick.
  async pollOnce(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      for (const clone of this.deps.hubClones()) {
        try {
          await this.pollClone(clone)
        } catch (err) {
          this.deps.log?.(`hub-nudges: ${clone}: ${(err as Error).message}`)
        }
      }
    } finally {
      this.polling = false
    }
  }

  private async pollClone(clone: string): Promise<void> {
    if (!existsSync(join(clone, '.git'))) return
    // Rebase handles the marker-push race: our unpushed delivered markers
    // replay cleanly over whatever the other machines pushed meanwhile.
    try { await this.git(clone, 'pull', '--rebase', '--quiet') } catch {
      this.deps.log?.(`hub-nudges: pull failed for ${clone} (offline?) — using local state`)
    }
    const dir = join(clone, NUDGES_DIR)
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.delivered.json'))
    const delivered: string[] = []
    const localNames = this.deps.listLocalSessionNames().map((n) => n.toLowerCase())
    for (const f of files) {
      if (existsSync(join(dir, f.replace(/\.json$/, '.delivered.json')))) continue
      let raw: unknown
      try { raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
      if (!isRecord(raw)) continue
      const target = splitTarget(raw.to)
      if (target.machine && target.machine.toLowerCase() !== this.machine.toLowerCase()) continue
      if (!target.machine && !localNames.includes(target.name.toLowerCase())) continue
      const absolute = join(clone, raw.path)
      if (!existsSync(absolute)) { this.deps.log?.(`hub-nudges: ${raw.id}: document missing in clone`); continue }
      const ok = await this.deps.deliver({ from: raw.from, to: target.name, subject: raw.subject, path: absolute })
      if (!ok) continue
      writeFileSync(
        join(dir, f.replace(/\.json$/, '.delivered.json')),
        JSON.stringify({ by: this.machine, ts: this.now() }, null, 2),
      )
      delivered.push(raw.id)
    }
    if (delivered.length > 0) {
      await this.git(clone, 'add', NUDGES_DIR)
      await this.git(clone, 'commit', '-q', '-m', `relay: delivered ${delivered.join(', ')} on ${this.machine}`)
      try { await this.git(clone, 'push', '-q') } catch {
        this.deps.log?.(`hub-nudges: push failed for ${clone} — markers retry next poll`)
      }
    }
  }

  // Outgoing: write a nudge record into the hub that holds the cited
  // document, commit, push. The caller has already decided this target is
  // cross-machine ("name@MACHINE" with a machine that is not ours).
  async sendViaHub(req: { from: string; to: string; subject: string; path: string }): Promise<{ ok: boolean; error?: string }> {
    const clone = this.deps.hubClones().find((c) => {
      const norm = (p: string): string => p.replace(/[\\/]+/g, '/').toLowerCase()
      return norm(req.path).startsWith(norm(c) + '/')
    })
    if (!clone) {
      return { ok: false, error: 'cross-machine nudges must cite a document inside a configured hub clone' }
    }
    const relative = req.path.slice(clone.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
    const id = `hubnudge-${this.now()}-${Math.floor(Math.random() * 1e6)}`
    const record: HubNudgeRecord = {
      schemaVersion: HUB_NUDGE_SCHEMA_VERSION,
      id,
      from: `${req.from}@${this.machine}`,
      to: req.to,
      subject: req.subject,
      path: relative,
      ts: this.now(),
    }
    try {
      const dir = join(clone, NUDGES_DIR)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(record, null, 2))
      await this.git(clone, 'add', NUDGES_DIR)
      await this.git(clone, 'commit', '-q', '-m', `relay: nudge ${id} to ${req.to}`)
      await this.git(clone, 'push', '-q')
    } catch (err) {
      return { ok: false, error: `hub send failed: ${(err as Error).message}` }
    }
    return { ok: true }
  }
}
