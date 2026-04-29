import { describe, it, expect, vi } from 'vitest'
import { PtyWatcher } from '../src/main/autopilot/pty-watcher'
import type { SettledSnapshot } from '../src/main/autopilot/types'

const IDLE_MS = 50  // smaller than default for fast tests
const NUDGE_MS = 200

describe('PtyWatcher', () => {
  it('emits a settled event after idle with [ORCH:WAITING]', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('Working...\n')
    w.feed('[ORCH:WAITING] Should I commit now?\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.kind).toBe('WAITING')
    expect(events[0].marker.text).toBe('Should I commit now?')
    vi.useRealTimers()
  })

  it('ignores ANSI escape codes when extracting text', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('\x1b[1;31mthinking…\x1b[0m\n[ORCH:WAITING] go?\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events[0].marker.text).toBe('go?')
    expect(events[0].text).not.toContain('\x1b')
    vi.useRealTimers()
  })

  it('does not emit when the most recent line lacks a marker', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('Just thinking out loud, no marker.\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(0)
    vi.useRealTimers()
  })

  it('detects PROGRESS marker with subgoal id and status', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('[ORCH:PROGRESS] m1/s2 done\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.kind).toBe('PROGRESS')
    expect(events[0].marker.subgoalId).toBe('m1/s2')
    expect(events[0].marker.status).toBe('done')
    vi.useRealTimers()
  })

  it('detects GOAL_READY marker', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('[ORCH:GOAL_READY]\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.kind).toBe('GOAL_READY')
    vi.useRealTimers()
  })

  it('detects STUCK marker', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('[ORCH:STUCK] cannot find git\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events[0].marker.kind).toBe('STUCK')
    expect(events[0].marker.text).toBe('cannot find git')
    vi.useRealTimers()
  })

  it('treats new bytes after marker as not-yet-settled', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('[ORCH:WAITING] q?\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS - 10)
    w.feed('but actually one more thing\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(0)
    w.feed('[ORCH:WAITING] really, q?\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.text).toBe('really, q?')
    vi.useRealTimers()
  })
})
