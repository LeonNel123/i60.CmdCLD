import type { DoerMarker, SettledSnapshot, MarkerKind } from './types'

interface Options {
  idleMs?: number
  nudgeMs?: number          // currently informational; consumer handles nudging
  forceSettleMs?: number    // when allStructured fails after a marker, settle anyway after this many ms with no new bytes (default 3000; 0 disables)
  onSettle: (snapshot: SettledSnapshot) => void
  onForceSettleArmed?: (firesAt: number) => void   // unix ms when force-settle will fire
  onForceSettleCanceled?: () => void
  onPermissionPrompt?: (text: string) => void
  onMissingMarker?: () => void
  markerFallbackMs?: number
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
  const m = line.match(MARKER_LINE_RE)
  if (!m) return null
  return { kind: m[1] as MarkerKind, tail: (m[2] ?? '').trim() }
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
        case 'PROGRESS_STATUS':
          if (val === 'done' || val === 'partial' || val === 'blocked') {
            out.progressStatusStructured = val
          }
          break
        // STATUS is not stored — kind is already extracted from the marker line
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

export function findLastMarker(text: string): { marker: DoerMarker; before: string } | null {
  const cleaned = stripTerminalAnsi(text)
  const lines = splitTerminalLines(cleaned)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const parsed = parseTerminalMarkerLine(line)
    if (!parsed) continue
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
    // Cross-check: if marker was bare PROGRESS but structured block has SUBGOAL / PROGRESS_STATUS, use those
    if (kind === 'PROGRESS' && !subgoalId && struct.subgoalIdStructured) {
      subgoalId = struct.subgoalIdStructured
    }
    if (kind === 'PROGRESS' && !status && struct.progressStatusStructured) {
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

  constructor(opts: Options) {
    this.idleMs = opts.idleMs ?? 1500
    this.nudgeMs = opts.nudgeMs ?? 10000
    this.forceSettleMs = opts.forceSettleMs ?? 3000
    this.markerFallbackMs = opts.markerFallbackMs ?? 30000
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

  reset(): void {
    this.buffer = ''
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
    const cleaned = stripTerminalAnsi(this.buffer)

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

    const found = findLastMarker(this.buffer)
    if (!found) {
      // No marker yet. Arm marker-fallback if buffer has substantive output.
      if (this.markerFallbackMs > 0 && !this.markerFallbackTimer && cleaned.length > 100) {
        this.markerFallbackTimer = setTimeout(() => this.fireMissingMarker(), this.markerFallbackMs)
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

  private fireMissingMarker(): void {
    this.markerFallbackTimer = null
    this.opts.onMissingMarker?.()
  }

  private forceSettle(): void {
    this.forceSettleTimer = null
    const found = findLastMarker(this.buffer)
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
    if (this.forceSettleTimer) { clearTimeout(this.forceSettleTimer); this.forceSettleTimer = null }
    if (this.markerFallbackTimer) { clearTimeout(this.markerFallbackTimer); this.markerFallbackTimer = null }
    this.permissionPromptActive = false
    this.onSettle(snapshot)
  }
}
