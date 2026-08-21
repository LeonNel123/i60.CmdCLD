import type { DoerMarker, SettledSnapshot, MarkerKind } from './types'

interface Options {
  idleMs?: number
  nudgeMs?: number          // currently informational; consumer handles nudging
  forceSettleMs?: number    // when allStructured fails after a marker, settle anyway after this many ms with no new bytes (default 3000; 0 disables)
  baselineChars?: number
  onSettle: (snapshot: SettledSnapshot) => void
  onForceSettleArmed?: (firesAt: number) => void   // unix ms when force-settle will fire
  onForceSettleCanceled?: () => void
  onPermissionPrompt?: (text: string) => void
  onMissingMarker?: (diagnostics: MissingMarkerDiagnostics) => void
  markerFallbackMs?: number
}

export interface MissingMarkerDiagnostics {
  rawChars: number
  cleanChars: number
  cleanTail: string
}

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[PX^_].*?\x1b\\|\x1b\][^\x1b]*\x1b\\/g
const MARKER_LINE_RE = /^(?:(?:[>|│┃║╎╏┆┇┊┋▌▍▎▏›❯•◦●○]+)\s*)?\[ORCH:(WAITING|PROGRESS|GOAL_READY|STUCK)\](?:\s+(.*))?$/

export function stripTerminalAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

export function splitTerminalLines(s: string): string[] {
  return s.split(/\r\n|\n|\r/)
}

export function parseTerminalMarkerLine(line: string): { kind: MarkerKind; tail: string } | null {
  const candidate = line.trimStart()
  const m = candidate.match(MARKER_LINE_RE)
  if (!m) return null
  const tail = (m[2] ?? '').trim()
  if (line.length !== candidate.length && looksLikeDocumentationTail(tail)) {
    return null
  }
  return { kind: m[1] as MarkerKind, tail }
}

/**
 * True for a tail that reads as documentation of the protocol rather than an instance of
 * it: a placeholder in angle brackets, a `done|partial|blocked` alternatives list, or an
 * imperative telling someone to emit a marker.
 *
 * This replaces a hyphen test — `/[—–-]\s+/` — that was broader than it looked. It
 * rejected any indented tail containing "- ", which suppressed genuine markers such as
 * `[ORCH:PROGRESS] p1/t1 - done`. Narrowing it lets more lines through, which is why the
 * fence and multi-token rules landed first.
 */
function looksLikeDocumentationTail(tail: string): boolean {
  if (/<[^>]+>/.test(tail)) return true
  if (/\b\w+\|\w+/.test(tail)) return true
  // Only the imperative with an elided subject — "please emit", "must emit". Two broader
  // cuts each rejected an ordinary tail: bare `please` killed `review please` (and four
  // PRO tests with it), and `emit the` killed `should I emit the commit now?`. The
  // intervening pronoun is what separates a question from an instruction, and word-level
  // rules on free text do not get more reliable than this — the structural rules above
  // are the ones carrying the weight.
  if (/\b(please|must|should)\s+emit\b/i.test(tail)) return true
  return false
}

const ORCH_TOKEN_RE = /\[ORCH:(?:WAITING|PROGRESS|GOAL_READY|STUCK)\]/g

/**
 * True for a line that carries more than one [ORCH:*] token.
 *
 * A doer emitting a marker emits exactly one per line. More than one means the protocol
 * is being described rather than used: the orchestrator's own missing-marker nudge listing
 * all four kinds, the doer contract's enumeration, an agent explaining itself. Those lines
 * reach the buffer as terminal echo, and behind a prompt glyph the first token sits at the
 * start of the line — close enough to a marker that both entry points accepted it.
 *
 * The cost is that a genuine marker whose tail mentions another kind is suppressed too.
 * That text belongs on the QUESTION: line of the structured block, which is where the
 * orchestrator reads it from anyway.
 */
function mentionsMultipleMarkerTokens(line: string): boolean {
  const tokens = line.match(ORCH_TOKEN_RE)
  return tokens !== null && tokens.length > 1
}

const STRUCTURED_KEYS = new Set([
  'STATUS', 'SUBGOAL', 'PROGRESS_STATUS', 'FILES_CHANGED', 'TESTS',
  'RED_PHASE', 'BOUNDARY_OK', 'EVIDENCE', 'BLOCKER', 'QUESTION',
])

interface StructuredFields {
  filesChanged?: string[]
  tests?: string
  redPhase?: 'yes' | 'no' | 'na'
  boundaryOk?: boolean
  evidence?: string
  blocker?: string
  question?: string
  // also picks up SUBGOAL / PROGRESS_STATUS for cross-check
  statusStructured?: 'waiting' | 'progress' | 'goal_ready' | 'stuck'
  subgoalIdStructured?: string
  progressStatusStructured?: 'done' | 'partial' | 'blocked'
}

function parseStructuredSegments(line: string): Array<{ key: string; val: string }> {
  const matches = Array.from(line.matchAll(/([A-Z_]+):\s*/g))
  return matches.map((match, idx) => {
    const key = match[1]
    const valueStart = (match.index ?? 0) + match[0].length
    const valueEnd = idx + 1 < matches.length ? matches[idx + 1].index ?? line.length : line.length
    return { key, val: line.slice(valueStart, valueEnd).trim() }
  })
}

function parseStructuredBlock(lines: string[]): StructuredFields {
  const out: StructuredFields = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const segments = parseStructuredSegments(line).filter((segment) => STRUCTURED_KEYS.has(segment.key))
    if (segments.length === 0) { i++; continue }

    const filesSegment = segments.find((segment) => segment.key === 'FILES_CHANGED')
    for (const { key, val } of segments) {
      if (key === 'FILES_CHANGED') continue
      switch (key) {
        case 'TESTS': out.tests = val; break
        case 'RED_PHASE':
          if (val === 'yes' || val === 'no' || val === 'na') out.redPhase = val
          break
        case 'BOUNDARY_OK': out.boundaryOk = (val.toLowerCase() === 'yes' || val.toLowerCase() === 'true'); break
        case 'EVIDENCE': out.evidence = val; break
        case 'BLOCKER': out.blocker = val; break
        case 'QUESTION': out.question = val; break
        case 'SUBGOAL': out.subgoalIdStructured = val; break
        case 'STATUS':
          if (val === 'waiting' || val === 'progress' || val === 'goal_ready' || val === 'stuck') {
            out.statusStructured = val
          }
          break
        case 'PROGRESS_STATUS':
          if (val === 'done' || val === 'partial' || val === 'blocked') {
            out.progressStatusStructured = val
          }
          break
      }
    }

    if (filesSegment) {
      const files: string[] = []
      // inline form: "FILES_CHANGED: a, b, c"
      if (filesSegment.val.length > 0) {
        for (const p of filesSegment.val.split(',').map((x) => x.trim()).filter(Boolean)) files.push(p)
      }
      // multi-line form: indented "  - file" continuation
      let j = i + 1
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        files.push(lines[j].replace(/^\s*-\s+/, '').trim())
        j++
      }
      out.filesChanged = files
      i = j
      continue
    }
    i++
  }
  return out
}

/**
 * Line indices sitting inside a balanced fenced code block.
 *
 * A marker quoted inside a fence is documentation. The line itself is identical to the
 * real thing — only the fence around it says otherwise, which is why this belongs here,
 * where the whole buffer is visible, and not in the line parser.
 *
 * An unbalanced fence is deliberately ignored. Honouring it would suppress every line
 * after it, the doer's own marker included, and since the buffer only clears on a settle
 * that state is sticky: the marker never lands, the missing-marker path nudges twice and
 * escalates. A stray ``` in prose must not be able to strand a run.
 */
function fencedLineIndices(lines: string[]): Set<number> {
  const fenced = new Set<number>()
  let openAt = -1
  let openChar = ''
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(```+|~~~+)/)
    if (!m) continue
    const char = m[1][0]
    if (openAt < 0) {
      openAt = i
      openChar = char
      continue
    }
    // A ~~~ line inside a ``` block is content, not the closing fence.
    if (char !== openChar) continue
    for (let j = openAt + 1; j < i; j++) fenced.add(j)
    openAt = -1
    openChar = ''
  }
  return fenced
}

export function findLastMarker(text: string): { marker: DoerMarker; before: string } | null {
  const cleaned = stripTerminalAnsi(text)
  const lines = splitTerminalLines(cleaned)
  const fenced = fencedLineIndices(lines)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (fenced.has(i)) continue
    const line = lines[i]
    if (mentionsMultipleMarkerTokens(line)) continue
    const parsed = parseTerminalMarkerLine(line)
    if (!parsed) continue
    // The line parser applies the documentation-tail rule only to indented lines, to keep
    // the contract its unit tests pin. At buffer level there is no such constraint: a
    // protocol line behind a prompt glyph is documentation wherever it sits.
    if (looksLikeDocumentationTail(parsed.tail)) continue
    const { kind, tail } = parsed
    let subgoalId: string | undefined
    let status: 'done' | 'partial' | 'blocked' | undefined
    if (kind === 'PROGRESS') {
      const pm = tail.match(/^(\S+)\s+(done|partial|blocked)$/)
      if (pm) {
        subgoalId = pm[1]
        status = pm[2] as 'done' | 'partial' | 'blocked'
      }
    }
    // Look at the lines AFTER the marker for a structured block
    const after = tail.includes(':') ? [tail, ...lines.slice(i + 1)] : lines.slice(i + 1)
    const struct = parseStructuredBlock(after)
    // Cross-check: if the structured block includes progress metadata, preserve
    // it even when the final marker is WAITING. Many CLIs emit one final
    // WAITING marker with STATUS: progress / SUBGOAL / PROGRESS_STATUS after
    // completing work; dropping those fields loses completed subgoals.
    if (!subgoalId && struct.subgoalIdStructured) {
      subgoalId = struct.subgoalIdStructured
    }
    if (!status && struct.progressStatusStructured) {
      status = struct.progressStatusStructured
    }
    const markerText = tail.includes(':') ? (struct.question || '') : (tail || struct.question || '')
    const before = lines.slice(0, i).join('\n')
    const marker: DoerMarker = {
      kind,
      text: markerText,
      raw: line,
      subgoalId,
      status,
      filesChanged: struct.filesChanged,
      tests: struct.tests,
      redPhase: struct.redPhase,
      boundaryOk: struct.boundaryOk,
      evidence: struct.evidence,
      blocker: struct.blocker,
      question: struct.question,
    }
    return { marker, before }
  }
  return null
}

export function recoverLiteralMarkerFromTail(text: string): DoerMarker | null {
  const cleaned = stripTerminalAnsi(text)
  const lines = splitTerminalLines(cleaned)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (mentionsMultipleMarkerTokens(line)) continue
    const token = line.match(/\[ORCH:(WAITING|PROGRESS|GOAL_READY|STUCK)\]/)
    if (!token || token.index === undefined) continue
    const before = line.slice(0, token.index)
    const tail = line.slice(token.index + token[0].length).trim()
    if (looksLikeProtocolMention(line, before, tail)) continue

    const kind = token[1] as MarkerKind
    let subgoalId: string | undefined
    let status: 'done' | 'partial' | 'blocked' | undefined
    if (kind === 'PROGRESS') {
      const pm = tail.match(/^(\S+)\s+(done|partial|blocked)\b/)
      if (!pm) continue
      subgoalId = pm[1]
      status = pm[2] as 'done' | 'partial' | 'blocked'
    }
    return {
      kind,
      text: tail,
      raw: line.trim(),
      subgoalId,
      status,
    }
  }
  return null
}

function looksLikeProtocolMention(line: string, before: string, tail: string): boolean {
  const lower = line.toLowerCase()
  if (lower.includes('please emit')) return true
  if (lower.includes('must contain') || lower.includes('marker line')) return true
  if (lower.includes('only during phase') || lower.includes('you need a decision')) return true
  if (/<[^>]+>/.test(tail)) return true
  if (/^[A-Za-z0-9 ,.'"`:/()[\]-]+$/.test(before.trim()) && before.trim().length > 0) return true
  return false
}

export class PtyWatcher {
  private buffer = ''
  private idleMs: number
  private nudgeMs: number
  private forceSettleMs: number
  private onSettle: Options['onSettle']
  private opts: Options
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private forceSettleTimer: ReturnType<typeof setTimeout> | null = null
  private markerFallbackMs: number
  private markerFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private permissionPromptActive = false
  private baselineChars: number

  constructor(opts: Options) {
    this.idleMs = opts.idleMs ?? 1500
    this.nudgeMs = opts.nudgeMs ?? 10000
    this.forceSettleMs = opts.forceSettleMs ?? 3000
    this.markerFallbackMs = opts.markerFallbackMs ?? 30000
    this.baselineChars = opts.baselineChars ?? 0
    this.onSettle = opts.onSettle
    this.opts = opts
  }

  feed(chunk: string): void {
    this.buffer += chunk
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.forceSettleTimer) {
      clearTimeout(this.forceSettleTimer)
      this.forceSettleTimer = null
      this.opts.onForceSettleCanceled?.()
    }
    if (this.markerFallbackTimer) {
      clearTimeout(this.markerFallbackTimer)
      this.markerFallbackTimer = null
    }
    this.idleTimer = setTimeout(() => this.checkSettled(), this.idleMs)
  }

  private activeBuffer(): string {
    return this.baselineChars > 0 ? this.buffer.slice(this.baselineChars) : this.buffer
  }

  reset(): void {
    this.buffer = ''
    this.baselineChars = 0
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
    if (this.forceSettleTimer) {
      clearTimeout(this.forceSettleTimer)
      this.forceSettleTimer = null
      this.opts.onForceSettleCanceled?.()
    }
    if (this.markerFallbackTimer) {
      clearTimeout(this.markerFallbackTimer)
      this.markerFallbackTimer = null
    }
    this.permissionPromptActive = false
  }

  private checkSettled(): void {
    const active = this.activeBuffer()
    const cleaned = stripTerminalAnsi(active)

    // Permission prompt detection: scan the last 1KB of cleaned output.
    const tail = cleaned.slice(-1024)
    const permissionMatch = this.detectPermissionPrompt(tail)
    if (permissionMatch && !this.permissionPromptActive) {
      this.permissionPromptActive = true
      this.opts.onPermissionPrompt?.(permissionMatch)
    } else if (!permissionMatch && this.permissionPromptActive) {
      // Claude has moved past the prompt; reset throttle.
      this.permissionPromptActive = false
    }

    const found = findLastMarker(active)
    if (!found) {
      // No marker yet. Arm marker-fallback if buffer has substantive output.
      if (this.markerFallbackMs > 0 && !this.markerFallbackTimer && cleaned.length > 100) {
        this.markerFallbackTimer = setTimeout(() => this.fireMissingMarker(cleaned, active), this.markerFallbackMs)
      }
      return
    }
    // Found a marker — clear any pending fallback (real settle is about to happen or be evaluated).
    if (this.markerFallbackTimer) {
      clearTimeout(this.markerFallbackTimer)
      this.markerFallbackTimer = null
    }

    const idx = cleaned.lastIndexOf(found.marker.raw)
    const after = cleaned.slice(idx + found.marker.raw.length)
    const afterTrimmed = splitTerminalLines(after).filter((l) => l.trim().length > 0)
    const allStructured = afterTrimmed.every((l) =>
      /^[A-Z_]+:/.test(l) || /^\s+\S/.test(l) || /^\s*-\s+/.test(l)
    )
    if (afterTrimmed.length > 0 && !allStructured) {
      if (this.forceSettleMs > 0 && !this.forceSettleTimer) {
        this.forceSettleTimer = setTimeout(() => this.forceSettle(), this.forceSettleMs)
        this.opts.onForceSettleArmed?.(Date.now() + this.forceSettleMs)
      }
      return
    }
    this.emitSettle(found)
  }

  private detectPermissionPrompt(tail: string): string | null {
    const patterns = [
      /Permission to (use|run|execute)\b[^\n]*/i,
      /Do you want to (proceed|continue|allow)\??[^\n]*/i,
      /Allow this (tool|operation|command)[^\n]*/i,
    ]
    for (const re of patterns) {
      const m = tail.match(re)
      if (m) return m[0]
    }
    // Numbered-choice prompt: a "1. Yes" line indicates Claude Code's permission UI.
    if (/^[\s>]*1\.\s*(Yes|Allow|Approve)/m.test(tail)) {
      const line = tail.match(/^[\s>]*1\.\s*[^\n]*/m)
      return line ? line[0] : 'permission prompt'
    }
    return null
  }

  private fireMissingMarker(cleaned?: string, raw?: string): void {
    this.markerFallbackTimer = null
    this.opts.onMissingMarker?.({
      rawChars: raw?.length ?? this.activeBuffer().length,
      cleanChars: cleaned?.length ?? stripTerminalAnsi(this.activeBuffer()).length,
      cleanTail: (cleaned ?? stripTerminalAnsi(this.activeBuffer())).slice(-4000),
    })
  }

  private forceSettle(): void {
    this.forceSettleTimer = null
    const found = findLastMarker(this.activeBuffer())
    if (!found) return    // marker disappeared (e.g., reset() between arming and firing)
    this.emitSettle(found)
  }

  private emitSettle(found: { marker: DoerMarker; before: string }): void {
    const snapshot: SettledSnapshot = {
      text: found.before.trim(),
      marker: found.marker,
      receivedAt: Date.now(),
    }
    this.buffer = ''
    this.baselineChars = 0
    if (this.forceSettleTimer) { clearTimeout(this.forceSettleTimer); this.forceSettleTimer = null }
    if (this.markerFallbackTimer) { clearTimeout(this.markerFallbackTimer); this.markerFallbackTimer = null }
    this.permissionPromptActive = false
    this.onSettle(snapshot)
  }
}
