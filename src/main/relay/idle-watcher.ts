// Per-session output-quiescence tracking for ALL sessions, not just ones an
// autopilot is attached to (CMDCLD-REQ-001-response.md §3). A session is
// "idle" when its pty has produced no output for idleMs. This is a weaker
// signal than autopilot's checkpoint state — output-quiet ≠ safe-to-submit —
// which is exactly why relay delivery is stage-only (no \r).

const DEFAULT_IDLE_MS = 1500

// A freshly spawned session is never a delivery target, however quiet it
// looks. Two things happen in its first seconds that a nudge must not land
// in the middle of: the shell has not necessarily drawn its prompt yet, and
// the host types the agent launch command (`claude …\r`) ~1 s after spawn.
// A nudge staged before that gets typed onto the shell's command line and is
// then submitted as part of the launch command — the shell runs garbage and
// the agent never starts. Hold every new session out of the pool until the
// launch has had time to happen and the agent has settled.
const DEFAULT_WARMUP_MS = 6000

export interface SessionIdleWatcherOptions {
  idleMs?: number
  warmupMs?: number
  now?: () => number
}

export class SessionIdleWatcher {
  private lastOutput = new Map<string, number>()
  private startedAt = new Map<string, number>()
  private idleMs: number
  private warmupMs: number
  private now: () => number

  constructor(opts: SessionIdleWatcherOptions = {}) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    this.warmupMs = opts.warmupMs ?? DEFAULT_WARMUP_MS
    this.now = opts.now ?? Date.now
  }

  // Called when the pty is spawned — before it can possibly have produced
  // output. This is what distinguishes "brand new, still starting up" from
  // "long-lived and quiet"; both look identical through lastOutput alone.
  noteStart(id: string): void {
    this.startedAt.set(id, this.now())
    this.lastOutput.delete(id)
  }

  noteData(id: string): void {
    this.lastOutput.set(id, this.now())
  }

  noteExit(id: string): void {
    this.lastOutput.delete(id)
    this.startedAt.delete(id)
  }

  isIdle(id: string): boolean {
    const started = this.startedAt.get(id)
    const last = this.lastOutput.get(id)
    if (started === undefined) {
      // No spawn record: the tracker started after this pty did (or a caller
      // creates ptys outside the wiring). Fall back to the output-only rule —
      // never-heard-from means it settled before we were watching.
      return last === undefined ? true : this.now() - last >= this.idleMs
    }
    if (this.now() - started < this.warmupMs) return false
    // Warmed up but has never emitted a byte: a live shell always prints at
    // least a prompt, so this one is wedged. Not a place to stage text.
    if (last === undefined) return false
    return this.now() - last >= this.idleMs
  }
}
