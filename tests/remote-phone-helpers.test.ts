import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const phone = require('../src/remote-ui/phone-helpers.js')

describe('formatAge', () => {
  it('shows minutes, hours and days, rounded down', () => {
    expect(phone.formatAge(4 * 60_000)).toBe('4m')
    expect(phone.formatAge(59 * 60_000 + 59_000)).toBe('59m')
    expect(phone.formatAge(60 * 60_000)).toBe('1h')
    expect(phone.formatAge(23 * 3_600_000)).toBe('23h')
    expect(phone.formatAge(49 * 3_600_000)).toBe('2d')
  })
  it('does not count seconds', () => {
    expect(phone.formatAge(0)).toBe('<1m')
    expect(phone.formatAge(59_999)).toBe('<1m')
  })
  it('is empty when the age is unknown', () => {
    expect(phone.formatAge(null)).toBe('')
    expect(phone.formatAge(undefined)).toBe('')
    expect(phone.formatAge(NaN)).toBe('')
    expect(phone.formatAge(-5)).toBe('')
  })
})

describe('localSince', () => {
  it('turns a server age into a timestamp on this device', () => {
    expect(phone.localSince(60_000, 500_000)).toBe(440_000)
  })
  it('stays unknown when the server does not know', () => {
    expect(phone.localSince(null, 500_000)).toBeNull()
    expect(phone.localSince(undefined, 500_000)).toBeNull()
  })
})

describe('isUnseen', () => {
  it('flags a session that went idle after it was last looked at', () => {
    expect(phone.isUnseen({ busy: false, since: 2000 }, 1000)).toBe(true)
  })
  it('does not flag one looked at since it went idle', () => {
    expect(phone.isUnseen({ busy: false, since: 2000 }, 3000)).toBe(false)
  })
  it('flags a finished session that was never opened here', () => {
    expect(phone.isUnseen({ busy: false, since: 2000 }, undefined)).toBe(true)
  })
  it('never flags a working session, or one with no known finish time', () => {
    expect(phone.isUnseen({ busy: true, since: 2000 }, 1000)).toBe(false)
    expect(phone.isUnseen({ busy: false, since: null }, 1000)).toBe(false)
    expect(phone.isUnseen(undefined, 1000)).toBe(false)
  })
})

// Top of the list is where the thumb goes first: what finished while you were
// away, then what is still running, then what you have already dealt with.
describe('sortForTriage', () => {
  const s = (id: string, name = id) => ({ id, name })
  const ids = (list: { id: string }[]) => list.map((x) => x.id)

  it('puts unseen finished sessions first, then working, then the rest', () => {
    const sessions = [s('seen'), s('busy'), s('fresh')]
    const activity = {
      seen: { busy: false, since: 5000 },
      busy: { busy: true, since: 100 },
      fresh: { busy: false, since: 4000 },
    }
    const seenAt = { seen: 6000, fresh: 1000 }
    expect(ids(phone.sortForTriage(sessions, activity, seenAt))).toEqual(['fresh', 'busy', 'seen'])
  })

  it('orders finished sessions most recent first', () => {
    const sessions = [s('old'), s('new')]
    const activity = { old: { busy: false, since: 1000 }, new: { busy: false, since: 9000 } }
    expect(ids(phone.sortForTriage(sessions, activity, {}))).toEqual(['new', 'old'])
    expect(ids(phone.sortForTriage(sessions, activity, { old: 99_999, new: 99_999 }))).toEqual(['new', 'old'])
  })

  it('falls back to name order, with unknown finish times last', () => {
    const sessions = [s('3', 'zeta'), s('2', 'alpha'), s('1', 'known')]
    const activity = { 1: { busy: false, since: 500 } }
    expect(ids(phone.sortForTriage(sessions, activity, { 1: 900 }))).toEqual(['1', '2', '3'])
    const busy = { 2: { busy: true, since: 1 }, 3: { busy: true, since: 2 } }
    expect(ids(phone.sortForTriage([s('3', 'zeta'), s('2', 'alpha')], busy, {}))).toEqual(['2', '3'])
  })

  it('does not reorder the list it was given', () => {
    const sessions = [s('b'), s('a')]
    phone.sortForTriage(sessions, {}, {})
    expect(ids(sessions)).toEqual(['b', 'a'])
  })
})

// The phone composer can only send text plus Enter. Agent menus and permission
// prompts are driven by Esc, arrows, Tab and a bare Enter.
describe('keySequence', () => {
  it('maps the keys a menu needs', () => {
    expect(phone.keySequence('esc')).toBe('\x1b')
    expect(phone.keySequence('enter')).toBe('\r')
    expect(phone.keySequence('tab')).toBe('\t')
    expect(phone.keySequence('shift-tab')).toBe('\x1b[Z')
    expect(phone.keySequence('up')).toBe('\x1b[A')
    expect(phone.keySequence('down')).toBe('\x1b[B')
    expect(phone.keySequence('right')).toBe('\x1b[C')
    expect(phone.keySequence('left')).toBe('\x1b[D')
  })
  // A full-screen TUI that switched the terminal to application cursor keys
  // ignores the normal-mode arrows.
  it('sends application-mode arrows when the program asked for them', () => {
    expect(phone.keySequence('up', true)).toBe('\x1bOA')
    expect(phone.keySequence('left', true)).toBe('\x1bOD')
    expect(phone.keySequence('esc', true)).toBe('\x1b')
  })
  it('returns null for a key it does not know', () => {
    expect(phone.keySequence('f13')).toBeNull()
    expect(phone.keySequence(undefined)).toBeNull()
  })
})

describe('fitDims', () => {
  it('takes the proposed size on the first fit', () => {
    expect(phone.fitDims({ cols: 48, rows: 30 }, null)).toEqual({ cols: 48, rows: 30 })
  })
  // The on-screen keyboard halves the output area. Shrinking the PTY to match
  // would make the agent repaint into eight rows on every tap of the input.
  it('keeps the rows when only the height shrank', () => {
    expect(phone.fitDims({ cols: 48, rows: 9 }, { cols: 48, rows: 30 })).toEqual({ cols: 48, rows: 30 })
  })
  it('grows the rows when there is more room', () => {
    expect(phone.fitDims({ cols: 48, rows: 34 }, { cols: 48, rows: 30 })).toEqual({ cols: 48, rows: 34 })
  })
  it('takes both again when the width changed (rotation, font size)', () => {
    expect(phone.fitDims({ cols: 100, rows: 14 }, { cols: 48, rows: 30 })).toEqual({ cols: 100, rows: 14 })
  })
  it('never goes below a usable size', () => {
    expect(phone.fitDims({ cols: 3, rows: 1 }, null)).toEqual({ cols: 20, rows: 6 })
  })
  it('returns null when there is no layout to measure yet', () => {
    expect(phone.fitDims(undefined, null)).toBeNull()
    expect(phone.fitDims({ cols: NaN, rows: 10 }, null)).toBeNull()
    expect(phone.fitDims({ cols: 40, rows: Infinity }, null)).toBeNull()
  })
})

describe('session hash', () => {
  const id = '3f2b8c1e-5d47-4a9b-8e21-0c6f7a1d9b42'
  it('round-trips a session id through the URL hash', () => {
    expect(phone.sessionHash(id)).toBe('#s=' + id)
    expect(phone.sessionFromHash('#s=' + id)).toBe(id)
  })
  it('ignores anything else', () => {
    expect(phone.sessionFromHash('')).toBeNull()
    expect(phone.sessionFromHash('#')).toBeNull()
    expect(phone.sessionFromHash('#other=1')).toBeNull()
    expect(phone.sessionFromHash('#s=')).toBeNull()
    expect(phone.sessionFromHash('#s=<script>')).toBeNull()
    expect(phone.sessionFromHash(undefined)).toBeNull()
  })
})
