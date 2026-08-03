// Per-session output-quiescence tracking for ALL sessions, not just ones an
// autopilot is attached to (CMDCLD-REQ-001-response.md §3). A session is
// "idle" when its pty has produced no output for idleMs. This is a weaker
// signal than autopilot's checkpoint state — output-quiet ≠ safe-to-submit —
// which is exactly why relay delivery is stage-only (no \r).

const DEFAULT_IDLE_MS = 1500

export interface SessionIdleWatcherOptions {
  idleMs?: number
  now?: () => number
}

export class SessionIdleWatcher {
  private lastOutput = new Map<string, number>()
  private idleMs: number
  private now: () => number

  constructor(opts: SessionIdleWatcherOptions = {}) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    this.now = opts.now ?? Date.now
  }

  noteData(id: string): void {
    this.lastOutput.set(id, this.now())
  }

  noteExit(id: string): void {
    this.lastOutput.delete(id)
  }

  // Sessions that never produced output count as idle: a live pty always
  // prints at least its prompt/banner on start, so an empty record means the
  // session settled before we started tracking (or the tracker restarted).
  isIdle(id: string): boolean {
    const last = this.lastOutput.get(id)
    if (last === undefined) return true
    return this.now() - last >= this.idleMs
  }
}
