import { describe, it, expect, vi } from 'vitest'
import {
  sanitizeSubject,
  sanitizeFromName,
  isUnderIntegrationOutbound,
  formatNudge,
  SUBJECT_MAX_LENGTH,
} from '../src/main/relay/validation'
import { SessionIdleWatcher } from '../src/main/relay/idle-watcher'
import { RelayManager, RelaySessionInfo } from '../src/main/relay/relay-manager'
import type { RelayState } from '../src/main/relay/types'

const OUTBOUND_DOC = 'D:\\Source\\i60\\release-manager\\docs\\integration\\outbound\\CMDCLD-REQ-001-cross-session-relay.md'

describe('relay validation', () => {
  it('strips control characters (incl. ESC, CR, LF) from subjects', () => {
    expect(sanitizeSubject('hello\x1b[31mworld\r\nagain\x00!')).toBe('hello [31mworld again !')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeSubject('  a   lot\t\tof   space  ')).toBe('a lot of space')
  })

  it('caps subject length at 120', () => {
    const long = 'x'.repeat(500)
    expect(sanitizeSubject(long)).toHaveLength(SUBJECT_MAX_LENGTH)
  })

  it('does not leave trailing whitespace after the cap cut', () => {
    const tricky = 'y'.repeat(SUBJECT_MAX_LENGTH - 1) + '  tail'
    const out = sanitizeSubject(tricky)
    expect(out).toBe(out.trim())
  })

  it('accepts paths under docs/integration/outbound with a file after it', () => {
    expect(isUnderIntegrationOutbound(OUTBOUND_DOC)).toBe(true)
    expect(isUnderIntegrationOutbound('/home/u/repo/docs/integration/outbound/x.md')).toBe(true)
    expect(isUnderIntegrationOutbound('D:/repo/DOCS/Integration/OUTBOUND/x.md')).toBe(true)
  })

  it('rejects paths outside the protocol location', () => {
    expect(isUnderIntegrationOutbound('D:\\repo\\docs\\integration\\inbound\\x.md')).toBe(false)
    expect(isUnderIntegrationOutbound('D:\\repo\\docs\\outbound\\x.md')).toBe(false)
    expect(isUnderIntegrationOutbound('C:\\Users\\me\\.ssh\\id_rsa')).toBe(false)
    // outbound dir itself, no file segment after it
    expect(isUnderIntegrationOutbound('D:\\repo\\docs\\integration\\outbound')).toBe(false)
    expect(isUnderIntegrationOutbound('')).toBe(false)
  })

  it('formats the standardized nudge with no newline and no trailing CR', () => {
    const nudge = formatNudge('release-manager', 'Protocol amendment', OUTBOUND_DOC)
    expect(nudge).toBe(`[cmdcld relay from release-manager] Protocol amendment — read: ${OUTBOUND_DOC}`)
    expect(nudge).not.toMatch(/[\r\n]/)
  })

  it('sanitizes hostile from-names and subjects inside the nudge', () => {
    const nudge = formatNudge('evil\r\nname', 'do\x1bthing', OUTBOUND_DOC)
    expect(nudge).not.toMatch(/[\x00-\x1f\x7f]/)
  })

  it('caps from-name at 60', () => {
    expect(sanitizeFromName('z'.repeat(200))).toHaveLength(60)
  })
})

describe('SessionIdleWatcher', () => {
  it('treats untracked sessions as idle', () => {
    const w = new SessionIdleWatcher({ now: () => 1000 })
    expect(w.isIdle('t1')).toBe(true)
  })

  it('marks a session busy right after output and idle after the threshold', () => {
    let t = 10_000
    const w = new SessionIdleWatcher({ idleMs: 1500, now: () => t })
    w.noteData('t1')
    expect(w.isIdle('t1')).toBe(false)
    t += 1499
    expect(w.isIdle('t1')).toBe(false)
    t += 1
    expect(w.isIdle('t1')).toBe(true)
  })

  it('forgets sessions on exit', () => {
    let t = 10_000
    const w = new SessionIdleWatcher({ idleMs: 1500, now: () => t })
    w.noteData('t1')
    w.noteExit('t1')
    expect(w.isIdle('t1')).toBe(true)
  })
})

interface Harness {
  manager: RelayManager
  writes: Array<{ terminalId: string; data: string }>
  saved: () => RelayState
  setSessions: (s: RelaySessionInfo[]) => void
  setIdle: (id: string, idle: boolean) => void
}

function makeHarness(opts: {
  sessions?: RelaySessionInfo[]
  persisted?: RelayState
  failWrite?: boolean
  canAutoSubmit?: (id: string) => boolean
} = {}): Harness {
  let sessions = opts.sessions ?? [{ id: 't1', name: 'toms-security' }]
  const idle = new Map<string, boolean>()
  const writes: Array<{ terminalId: string; data: string }> = []
  let stored: RelayState = opts.persisted ?? { queue: [], log: [] }
  let now = 1_000_000
  const manager = new RelayManager({
    listSessions: () => sessions,
    isIdle: (id) => idle.get(id) ?? true,
    writeStaged: async (terminalId, data) => {
      if (opts.failWrite) throw new Error('pty gone')
      writes.push({ terminalId, data })
    },
    store: {
      load: () => stored,
      save: (s) => { stored = { queue: [...s.queue], log: [...s.log] } },
    },
    canAutoSubmit: opts.canAutoSubmit,
    isFile: (p) => p.endsWith('.md'),
    now: () => (now += 1),
  })
  return {
    manager,
    writes,
    saved: () => stored,
    setSessions: (s) => { sessions = s },
    setIdle: (id, v) => idle.set(id, v),
  }
}

describe('RelayManager', () => {
  it('delivers to an idle resolved session, staged (no trailing \\r)', async () => {
    const h = makeHarness()
    const res = await h.manager.send({ from: 'cmdcld', to: 'toms-security', subject: 'hi', path: OUTBOUND_DOC })
    expect(res.ok).toBe(true)
    expect(res.status).toBe('delivered')
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].terminalId).toBe('t1')
    expect(h.writes[0].data.endsWith('\r')).toBe(false)
    expect(h.writes[0].data).toContain('[cmdcld relay from cmdcld] hi — read: ')
    const log = h.manager.getState().log
    expect(log).toHaveLength(1)
    expect(log[0].status).toBe('delivered')
    expect(log[0].terminalId).toBe('t1')
  })

  it('resolves by terminal id as well as name', async () => {
    const h = makeHarness()
    const res = await h.manager.send({ from: 'a', to: 't1', subject: 's', path: OUTBOUND_DOC })
    expect(res.status).toBe('delivered')
  })

  it('queues while the target is busy, delivers on tick when idle', async () => {
    const h = makeHarness()
    h.setIdle('t1', false)
    const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    expect(res.status).toBe('queued')
    expect(h.manager.getState().queue).toHaveLength(1)
    expect(h.writes).toHaveLength(0)

    await h.manager.tick()
    expect(h.writes).toHaveLength(0) // still busy

    h.setIdle('t1', true)
    await h.manager.tick()
    expect(h.writes).toHaveLength(1)
    expect(h.manager.getState().queue).toHaveLength(0)
    const statuses = h.manager.getState().log.map((l) => l.status)
    expect(statuses).toEqual(['queued', 'delivered'])
  })

  it('queues unknown targets instead of dropping, and surfaces the reason', async () => {
    const h = makeHarness({ sessions: [] })
    const res = await h.manager.send({ from: 'a', to: 'nobody', subject: 's', path: OUTBOUND_DOC })
    expect(res.status).toBe('queued')
    expect(h.manager.getState().queue[0].reason).toBe('unknown-target')
    // target appears later
    h.setSessions([{ id: 't9', name: 'nobody' }])
    await h.manager.tick()
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].terminalId).toBe('t9')
  })

  it('queues ambiguous names', async () => {
    const h = makeHarness({ sessions: [
      { id: 'a1', name: 'proj' },
      { id: 'a2', name: 'proj' },
    ] })
    const res = await h.manager.send({ from: 'a', to: 'proj', subject: 's', path: OUTBOUND_DOC })
    expect(res.status).toBe('queued')
    expect(h.manager.getState().queue[0].reason).toBe('ambiguous-target')
  })

  it('refuses paths outside docs/integration/outbound', async () => {
    const h = makeHarness()
    const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: 'C:\\secrets\\key.md' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('refused')
    expect(res.error).toContain('docs/integration/outbound')
    expect(h.writes).toHaveLength(0)
    expect(h.manager.getState().log[0].status).toBe('refused')
  })

  it('refuses missing files and empty subjects', async () => {
    const h = makeHarness()
    const missing = await h.manager.send({
      from: 'a', to: 'toms-security', subject: 's',
      path: 'D:\\r\\docs\\integration\\outbound\\nope.txt',
    })
    expect(missing.status).toBe('refused')
    const empty = await h.manager.send({ from: 'a', to: 'toms-security', subject: '\x1b\r\n', path: OUTBOUND_DOC })
    expect(empty.status).toBe('refused')
    expect(empty.error).toContain('subject')
  })

  it('persists queue and log through the store, and restores them', async () => {
    const h = makeHarness()
    h.setIdle('t1', false)
    await h.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    const persisted = h.saved()
    expect(persisted.queue).toHaveLength(1)

    // "restart": a fresh manager over the same store contents
    const h2 = makeHarness({ persisted })
    expect(h2.manager.getState().queue).toHaveLength(1)
    await h2.manager.tick()
    expect(h2.writes).toHaveLength(1)
  })

  it('keeps the item queued when the pty write fails', async () => {
    const h = makeHarness({ failWrite: true })
    const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    expect(res.status).toBe('queued')
    await h.manager.tick()
    expect(h.manager.getState().queue).toHaveLength(1)
  })

  it('cancel removes a queued relay and logs it', async () => {
    const h = makeHarness()
    h.setIdle('t1', false)
    const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    expect(h.manager.cancel(res.id)).toBe(true)
    expect(h.manager.getState().queue).toHaveLength(0)
    const statuses = h.manager.getState().log.map((l) => l.status)
    expect(statuses).toEqual(['queued', 'cancelled'])
    expect(h.manager.cancel('nope')).toBe(false)
  })

  it('emits update events on every state change', async () => {
    const h = makeHarness()
    const spy = vi.fn()
    h.manager.on('update', spy)
    await h.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    expect(spy).toHaveBeenCalled()
  })

  it('allows a burst of 10 back-to-back, refuses the 11th', async () => {
    const h = makeHarness()
    // A replay sweep announcing six related threads must not be mistaken for a
    // ping-pong loop — that shape is why the flat 6/hour cap was replaced.
    for (let i = 0; i < 10; i += 1) {
      const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: `s${i}`, path: OUTBOUND_DOC })
      expect(res.ok).toBe(true)
    }
    const eleventh = await h.manager.send({ from: 'a', to: 'toms-security', subject: 's11', path: OUTBOUND_DOC })
    expect(eleventh.status).toBe('refused')
    expect(eleventh.error).toContain('rate limit')
    expect(eleventh.error).toContain('next slot in')
    // a different pair has its own bucket
    h.setSessions([{ id: 't1', name: 'toms-security' }, { id: 't2', name: 'other' }])
    const otherPair = await h.manager.send({ from: 'a', to: 'other', subject: 's', path: OUTBOUND_DOC })
    expect(otherPair.ok).toBe(true)
  })

  it('charges a queued-then-delivered relay one token, not two', async () => {
    const h = makeHarness()
    // Five relays that queue while busy and deliver later write ten log rows
    // under five ids. Counting rows charged busy targets double.
    h.setIdle('t1', false)
    for (let i = 0; i < 5; i += 1) {
      const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: `q${i}`, path: OUTBOUND_DOC })
      expect(res.status).toBe('queued')
    }
    h.setIdle('t1', true)
    await h.manager.tick()
    expect(h.writes).toHaveLength(5)
    expect(h.manager.getState().log).toHaveLength(10)  // 5 queued + 5 delivered rows

    // Five tokens should remain, not zero.
    for (let i = 0; i < 5; i += 1) {
      const res = await h.manager.send({ from: 'a', to: 'toms-security', subject: `d${i}`, path: OUTBOUND_DOC })
      expect(res.status).toBe('delivered')
    }
    const overBudget = await h.manager.send({ from: 'a', to: 'toms-security', subject: 'over', path: OUTBOUND_DOC })
    expect(overBudget.status).toBe('refused')
  })

  it('refills one token per 10 minutes after a spent burst', async () => {
    let clock = 5_000_000
    const stored: RelayState = { queue: [], log: [] }
    const writes: Array<{ terminalId: string; data: string }> = []
    const manager = new RelayManager({
      listSessions: () => [{ id: 't1', name: 'toms-security' }],
      isIdle: () => true,
      writeStaged: async (terminalId, data) => { writes.push({ terminalId, data }) },
      store: { load: () => stored, save: (s) => { stored.queue = [...s.queue]; stored.log = [...s.log] } },
      isFile: () => true,
      now: () => clock,
    })
    for (let i = 0; i < 10; i += 1) {
      clock += 1000
      expect((await manager.send({ from: 'a', to: 'toms-security', subject: `s${i}`, path: OUTBOUND_DOC })).ok).toBe(true)
    }
    clock += 1000
    expect((await manager.send({ from: 'a', to: 'toms-security', subject: 'x', path: OUTBOUND_DOC })).status).toBe('refused')

    clock += 9 * 60 * 1000   // 9 minutes — still short of a token
    expect((await manager.send({ from: 'a', to: 'toms-security', subject: 'y', path: OUTBOUND_DOC })).status).toBe('refused')

    clock += 2 * 60 * 1000   // past the 10-minute refill
    expect((await manager.send({ from: 'a', to: 'toms-security', subject: 'z', path: OUTBOUND_DOC })).status).toBe('delivered')
  })

  it('appends the submit \\r only when canAutoSubmit allows the target', async () => {
    const auto = makeHarness({ canAutoSubmit: (id) => id === 't1' })
    await auto.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    expect(auto.writes[0].data.endsWith('\r')).toBe(true)

    const staged = makeHarness({ canAutoSubmit: () => false })
    await staged.manager.send({ from: 'a', to: 'toms-security', subject: 's', path: OUTBOUND_DOC })
    expect(staged.writes[0].data.endsWith('\r')).toBe(false)
  })
})
