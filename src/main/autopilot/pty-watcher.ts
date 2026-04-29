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
    const before = lines.slice(0, i).join('\n')
    return {
      marker: { kind, text: tail, raw: line, subgoalId, status },
      before,
    }
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
    if (after.trim().length > 0) return
    const snapshot: SettledSnapshot = {
      text: found.before.trim(),
      marker: found.marker,
      receivedAt: Date.now(),
    }
    this.buffer = ''
    this.onSettle(snapshot)
  }
}
