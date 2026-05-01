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

  it('parses structured Status Report fields after the marker line', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed([
      'Did the work.\n',
      '[ORCH:WAITING]\n',
      'STATUS: waiting\n',
      'FILES_CHANGED:\n',
      '  - src/foo.ts\n',
      '  - tests/foo.test.ts\n',
      'TESTS: 134 passed / 0 failed\n',
      'RED_PHASE: yes\n',
      'BOUNDARY_OK: yes\n',
      'EVIDENCE: build green, all 134 pass\n',
      'QUESTION: continue?\n',
    ].join(''))
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    const m = events[0].marker
    expect(m.kind).toBe('WAITING')
    expect(m.filesChanged).toEqual(['src/foo.ts', 'tests/foo.test.ts'])
    expect(m.tests).toBe('134 passed / 0 failed')
    expect(m.redPhase).toBe('yes')
    expect(m.boundaryOk).toBe(true)
    expect(m.evidence).toBe('build green, all 134 pass')
    expect(m.question).toBe('continue?')
    vi.useRealTimers()
  })

  it('falls back to single-line marker when no structured block follows', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed('[ORCH:WAITING] just a question\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.kind).toBe('WAITING')
    expect(events[0].marker.text).toBe('just a question')
    expect(events[0].marker.filesChanged).toBeUndefined()
    expect(events[0].marker.boundaryOk).toBeUndefined()
    vi.useRealTimers()
  })

  it('parses partial structured blocks without throwing', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed([
      '[ORCH:STUCK]\n',
      'STATUS: stuck\n',
      'BLOCKER: cannot find npm\n',
    ].join(''))
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.kind).toBe('STUCK')
    expect(events[0].marker.blocker).toBe('cannot find npm')
    expect(events[0].marker.boundaryOk).toBeUndefined()
    vi.useRealTimers()
  })

  it('parses BOUNDARY_OK: no as boolean false', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({ idleMs: IDLE_MS, nudgeMs: NUDGE_MS, onSettle: (s) => events.push(s) })
    w.feed([
      '[ORCH:WAITING]\n',
      'STATUS: waiting\n',
      'BOUNDARY_OK: no\n',
      'QUESTION: I touched a forbidden file, what next?\n',
    ].join(''))
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events[0].marker.boundaryOk).toBe(false)
    vi.useRealTimers()
  })
})

describe('PtyWatcher force-settle (Wave 3.3)', () => {
  const FORCE_SETTLE_MS = 100  // small for fast tests; default in production is 3000

  it('force-settles after FORCE_SETTLE_MS when chrome follows marker', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({
      idleMs: IDLE_MS,
      nudgeMs: NUDGE_MS,
      forceSettleMs: FORCE_SETTLE_MS,
      onSettle: (s) => events.push(s),
    })
    w.feed('[ORCH:WAITING] q?\n')
    w.feed('± Worked for 5m 6s\n\n>\n\n>> bypass permissions on (shift+tab to cycle)\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(FORCE_SETTLE_MS + 5)
    expect(events).toHaveLength(1)
    expect(events[0].marker.kind).toBe('WAITING')
    expect(events[0].marker.text).toBe('q?')
    vi.useRealTimers()
  })

  it('cancels force-settle when new bytes arrive within the window', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({
      idleMs: IDLE_MS,
      nudgeMs: NUDGE_MS,
      forceSettleMs: FORCE_SETTLE_MS,
      onSettle: (s) => events.push(s),
    })
    w.feed('[ORCH:WAITING] q?\n')
    w.feed('± Worked for 5m\n>\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(FORCE_SETTLE_MS / 2)
    w.feed('still typing more chrome\n')
    await vi.advanceTimersByTimeAsync(FORCE_SETTLE_MS / 2 + 5)
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(IDLE_MS + FORCE_SETTLE_MS + 10)
    expect(events).toHaveLength(1)
    expect(events[0].marker.text).toBe('q?')
    vi.useRealTimers()
  })

  it('force-settle is a no-op after reset()', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({
      idleMs: IDLE_MS,
      nudgeMs: NUDGE_MS,
      forceSettleMs: FORCE_SETTLE_MS,
      onSettle: (s) => events.push(s),
    })
    w.feed('[ORCH:WAITING] q?\n')
    w.feed('chrome line at column 0\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    w.reset()
    await vi.advanceTimersByTimeAsync(FORCE_SETTLE_MS + 5)
    expect(events).toHaveLength(0)
    vi.useRealTimers()
  })

  it('forceSettleMs option overrides default', async () => {
    vi.useFakeTimers()
    const events: SettledSnapshot[] = []
    const w = new PtyWatcher({
      idleMs: IDLE_MS,
      nudgeMs: NUDGE_MS,
      forceSettleMs: 200,
      onSettle: (s) => events.push(s),
    })
    w.feed('[ORCH:WAITING] q?\n')
    w.feed('± Worked\n>\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(105)
    expect(events).toHaveLength(1)
    vi.useRealTimers()
  })
})

describe('PtyWatcher force-settle callbacks (Wave 3.4)', () => {
  const FORCE_SETTLE_MS = 100

  it('fires onForceSettleArmed with the correct fire-time when allStructured fails', async () => {
    vi.useFakeTimers()
    const START_TIME = new Date('2026-04-30T20:00:00.000Z').getTime()
    vi.setSystemTime(START_TIME)
    const armed: number[] = []
    const w = new PtyWatcher({
      idleMs: IDLE_MS,
      nudgeMs: NUDGE_MS,
      forceSettleMs: FORCE_SETTLE_MS,
      onSettle: () => {},
      onForceSettleArmed: (firesAt) => armed.push(firesAt),
    })
    w.feed('[ORCH:WAITING] q?\n')
    w.feed('chrome at column 0\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(armed).toHaveLength(1)
    // The idle timer fires at exactly IDLE_MS; firesAt = (START_TIME + IDLE_MS) + FORCE_SETTLE_MS.
    expect(armed[0]).toBe(START_TIME + IDLE_MS + FORCE_SETTLE_MS)
    vi.useRealTimers()
  })

  it('fires onForceSettleCanceled when new bytes arrive after arming', async () => {
    vi.useFakeTimers()
    let armedCount = 0
    let canceledCount = 0
    const w = new PtyWatcher({
      idleMs: IDLE_MS,
      nudgeMs: NUDGE_MS,
      forceSettleMs: FORCE_SETTLE_MS,
      onSettle: () => {},
      onForceSettleArmed: () => armedCount++,
      onForceSettleCanceled: () => canceledCount++,
    })
    w.feed('[ORCH:WAITING] q?\n')
    w.feed('chrome at column 0\n')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 5)
    expect(armedCount).toBe(1)
    expect(canceledCount).toBe(0)
    w.feed('more bytes\n')   // cancels force-settle
    expect(canceledCount).toBe(1)
    vi.useRealTimers()
  })
})
