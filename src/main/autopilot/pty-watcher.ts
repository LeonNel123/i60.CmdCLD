import type { DoerMarker, SettledSnapshot, MarkerKind } from './types'

interface Options {
  idleMs?: number
  nudgeMs?: number          // currently informational; consumer handles nudging
  onSettle: (snapshot: SettledSnapshot) => void
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[PX^_].*?\x1b\\|\x1b\][^\x1b]*\x1b\\/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
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

function parseStructuredBlock(lines: string[]): StructuredFields {
  const out: StructuredFields = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const km = line.match(/^([A-Z_]+):\s*(.*)$/)
    if (!km || !STRUCTURED_KEYS.has(km[1])) { i++; continue }
    const key = km[1]
    const val = km[2].trim()
    if (key === 'FILES_CHANGED') {
      const files: string[] = []
      // inline form: "FILES_CHANGED: a, b, c"
      if (val.length > 0) {
        for (const p of val.split(',').map((x) => x.trim()).filter(Boolean)) files.push(p)
      }
      // multi-line form: indented "  - file" continuation
      let j = i + 1
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        files.push(lines[j].replace(/^\s+-\s+/, '').trim())
        j++
      }
      out.filesChanged = files
      i = j
      continue
    }
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
    i++
  }
  return out
}

export function findLastMarker(text: string): { marker: DoerMarker; before: string } | null {
  const cleaned = stripAnsi(text)
  const lines = cleaned.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const m = line.match(/^\[ORCH:(WAITING|PROGRESS|GOAL_READY|STUCK)\](?:\s+(.*))?$/)
    if (!m) continue
    const kind = m[1] as MarkerKind
    const tail = (m[2] ?? '').trim()
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
    const after = lines.slice(i + 1)
    const struct = parseStructuredBlock(after)
    // Cross-check: if marker was bare PROGRESS but structured block has SUBGOAL / PROGRESS_STATUS, use those
    if (kind === 'PROGRESS' && !subgoalId && struct.subgoalIdStructured) {
      subgoalId = struct.subgoalIdStructured
    }
    if (kind === 'PROGRESS' && !status && struct.progressStatusStructured) {
      status = struct.progressStatusStructured
    }
    const before = lines.slice(0, i).join('\n')
    const marker: DoerMarker = {
      kind,
      text: tail || struct.question || '',
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
  private onSettle: Options['onSettle']
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: Options) {
    this.idleMs = opts.idleMs ?? 1500
    this.nudgeMs = opts.nudgeMs ?? 10000
    this.onSettle = opts.onSettle
  }

  feed(chunk: string): void {
    this.buffer += chunk
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.checkSettled(), this.idleMs)
  }

  reset(): void {
    this.buffer = ''
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private checkSettled(): void {
    const found = findLastMarker(this.buffer)
    if (!found) return
    const cleaned = stripAnsi(this.buffer)
    const idx = cleaned.lastIndexOf(found.marker.raw)
    const after = cleaned.slice(idx + found.marker.raw.length)
    // Structured block is allowed: lines starting with KEY: or indented continuations.
    const afterTrimmed = after.split(/\r?\n/).filter((l) => l.trim().length > 0)
    const allStructured = afterTrimmed.every((l) =>
      /^[A-Z_]+:/.test(l) || /^\s+\S/.test(l)
    )
    if (afterTrimmed.length > 0 && !allStructured) return
    const snapshot: SettledSnapshot = {
      text: found.before.trim(),
      marker: found.marker,
      receivedAt: Date.now(),
    }
    this.buffer = ''
    this.onSettle(snapshot)
  }
}
