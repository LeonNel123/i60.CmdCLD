/**
 * Busy/idle per session, tracked in main so every remote client shares one
 * clock.
 *
 * The phone's session list sorts by "finished since you last looked" and shows
 * how long each session has been working or idle. A client cannot work that
 * out for itself: it has no history from before it connected, and it would
 * need every session's output streamed to it just to drive a status dot.
 *
 * Busy means output has been flowing for at least `minBusyMs`. A single burst
 * is not work — a resize makes an agent repaint its whole screen and then go
 * quiet, and counting that would restart the idle clock (and re-sort the list)
 * whenever a window changes size. Idle is `idleMs` without output, dated from
 * the last output rather than from when the quiet period ran out.
 */
export interface ActivityState {
  busy: boolean
  /** Epoch ms the current state began; null when it predates this tracker. */
  since: number | null
}

interface Entry extends ActivityState {
  /** First output of a spell that has not (yet) lasted long enough to count. */
  spellStart: number | null
  lastDataAt: number
  timer: ReturnType<typeof setTimeout> | null
}

export class SessionActivityTracker {
  private entries = new Map<string, Entry>()
  private readonly onChange: (id: string, state: ActivityState) => void
  private readonly idleMs: number
  private readonly minBusyMs: number

  constructor(opts: {
    onChange: (id: string, state: ActivityState) => void
    idleMs?: number
    minBusyMs?: number
  }) {
    this.onChange = opts.onChange
    this.idleMs = opts.idleMs ?? 2000
    this.minBusyMs = opts.minBusyMs ?? 1000
  }

  /** Call for every chunk of PTY output. One timer per session, re-armed only
   *  when it fires, so a flood of output costs a Map lookup per chunk. */
  onData(id: string): void {
    const now = Date.now()
    let e = this.entries.get(id)
    if (!e) {
      e = { busy: false, since: null, spellStart: null, lastDataAt: now, timer: null }
      this.entries.set(id, e)
    }
    e.lastDataAt = now
    if (!e.busy) {
      if (e.spellStart === null) {
        e.spellStart = now
      } else if (now - e.spellStart >= this.minBusyMs) {
        e.busy = true
        e.since = e.spellStart
        this.onChange(id, { busy: true, since: e.since })
      }
    }
    if (!e.timer) this.arm(id, e, this.idleMs)
  }

  get(id: string): ActivityState {
    const e = this.entries.get(id)
    return e ? { busy: e.busy, since: e.since } : { busy: false, since: null }
  }

  remove(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    this.entries.delete(id)
  }

  reset(): void {
    for (const e of this.entries.values()) {
      if (e.timer) clearTimeout(e.timer)
    }
    this.entries.clear()
  }

  private arm(id: string, e: Entry, delay: number): void {
    e.timer = setTimeout(() => {
      e.timer = null
      const quiet = Date.now() - e.lastDataAt
      if (quiet < this.idleMs) {
        this.arm(id, e, this.idleMs - quiet)
        return
      }
      e.spellStart = null
      if (e.busy) {
        e.busy = false
        e.since = e.lastDataAt
        this.onChange(id, { busy: false, since: e.since })
      }
    }, delay)
  }
}

/** What goes to clients. An age, not a timestamp: a phone's clock and this
 *  machine's can disagree by more than the durations being shown. */
export function activityWire(state: ActivityState, now: number): { busy: boolean; ageMs: number | null } {
  return { busy: state.busy, ageMs: state.since === null ? null : Math.max(0, now - state.since) }
}
