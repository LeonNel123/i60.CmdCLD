import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SessionActivityTracker, activityWire, type ActivityState } from '../src/main/remote-activity'

// The phone's session list shows "Working 2m" / "Idle 4m" and floats sessions
// that finished since you last looked. That needs one clock for every client,
// so the server tracks it — a phone that just connected has no history of its
// own, and streaming every session's output to it just to drive a dot costs
// mobile data.
describe('SessionActivityTracker', () => {
  let events: { id: string; state: ActivityState }[]
  let tracker: SessionActivityTracker

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    events = []
    tracker = new SessionActivityTracker({
      onChange: (id, state) => { events.push({ id, state }) },
      idleMs: 2000,
      minBusyMs: 1000,
    })
  })
  afterEach(() => {
    tracker.reset()
    vi.useRealTimers()
  })

  /** Output every 200 ms for `ms` milliseconds. */
  function work(id: string, ms: number): void {
    for (let t = 0; t <= ms; t += 200) {
      tracker.onData(id)
      if (t < ms) vi.advanceTimersByTime(200)
    }
  }

  it('reports a session it has never seen as idle for an unknown time', () => {
    expect(tracker.get('nope')).toEqual({ busy: false, since: null })
  })

  // A resize makes the agent repaint its whole screen: one burst of output and
  // nothing after. Counting that as work would re-sort the list and restart
  // the "idle for" clock every time a window changes size.
  it('ignores a single burst of output', () => {
    tracker.onData('a')
    vi.advanceTimersByTime(10_000)
    expect(events).toEqual([])
    expect(tracker.get('a')).toEqual({ busy: false, since: null })
  })

  it('turns busy once output has been sustained, dated from when it began', () => {
    work('a', 1200)
    expect(tracker.get('a')).toEqual({ busy: true, since: 1_000_000 })
    expect(events).toEqual([{ id: 'a', state: { busy: true, since: 1_000_000 } }])
  })

  it('turns idle after the quiet period, dated from the last output', () => {
    work('a', 1200)
    vi.advanceTimersByTime(1999)
    expect(tracker.get('a').busy).toBe(true)
    vi.advanceTimersByTime(1)
    expect(tracker.get('a')).toEqual({ busy: false, since: 1_001_200 })
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ id: 'a', state: { busy: false, since: 1_001_200 } })
  })

  it('keeps one busy spell across pauses shorter than the quiet period', () => {
    work('a', 1200)
    vi.advanceTimersByTime(1500)
    work('a', 400)
    expect(events).toHaveLength(1)
    expect(tracker.get('a')).toEqual({ busy: true, since: 1_000_000 })
  })

  it('leaves the idle clock alone when a burst follows real work', () => {
    work('a', 1200)
    vi.advanceTimersByTime(60_000)
    tracker.onData('a')
    vi.advanceTimersByTime(60_000)
    expect(events).toHaveLength(2)
    expect(tracker.get('a')).toEqual({ busy: false, since: 1_001_200 })
  })

  it('tracks sessions independently', () => {
    work('a', 1200)
    tracker.onData('b')
    expect(tracker.get('a').busy).toBe(true)
    expect(tracker.get('b').busy).toBe(false)
  })

  it('forgets a removed session without a parting event', () => {
    work('a', 1200)
    tracker.remove('a')
    vi.advanceTimersByTime(10_000)
    expect(events).toHaveLength(1)
    expect(tracker.get('a')).toEqual({ busy: false, since: null })
  })

  // The server stops when remote access is switched off; a timer left behind
  // would announce on a closed socket server.
  it('reset() drops every session and its timer', () => {
    work('a', 1200)
    work('b', 1200)
    const before = events.length
    tracker.reset()
    vi.advanceTimersByTime(10_000)
    expect(events).toHaveLength(before)
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Phone and PC clocks differ, so the wire carries an age, not a timestamp.
describe('activityWire', () => {
  it('sends how long the state has held', () => {
    expect(activityWire({ busy: false, since: 5000 }, 65_000)).toEqual({ busy: false, ageMs: 60_000 })
  })
  it('sends a null age when the time is unknown', () => {
    expect(activityWire({ busy: false, since: null }, 65_000)).toEqual({ busy: false, ageMs: null })
  })
  it('never sends a negative age', () => {
    expect(activityWire({ busy: true, since: 70_000 }, 65_000)).toEqual({ busy: true, ageMs: 0 })
  })
})
