import { describe, it, expect } from 'vitest'
import {
  parsePhases, currentPhase, phaseDoneFromTasks,
} from '../src/main/autopilot-pro/phases'

describe('parsePhases', () => {
  it('returns [] for empty input', () => {
    expect(parsePhases('')).toEqual([])
  })

  it('returns [] when no parseable phase headers', () => {
    expect(parsePhases('# Plan\n\nSome free-form text.')).toEqual([])
  })

  it('parses "## Phase 1: name" header', () => {
    const md = `## Phase 1: setup
- [ ] T1: install deps
- [ ] T2: configure
`
    const ps = parsePhases(md)
    expect(ps).toHaveLength(1)
    expect(ps[0].id).toBe('phase-1')
    expect(ps[0].name).toBe('setup')
    expect(ps[0].tasks).toHaveLength(2)
    expect(ps[0].tasks[0].id).toBe('T1')
    expect(ps[0].tasks[0].description).toBe('install deps')
    expect(ps[0].tasks[0].done).toBe(false)
    expect(ps[0].status).toBe('pending')
  })

  it('parses "## Phase 2 — name" em-dash header', () => {
    const md = `## Phase 2 — execute
- [ ] T1: do
`
    const ps = parsePhases(md)
    expect(ps[0].id).toBe('phase-2')
    expect(ps[0].name).toBe('execute')
  })

  it('parses "## Phase alpha: name" non-numeric id', () => {
    const md = `## Phase alpha: investigate
- [ ] T1: dig
`
    const ps = parsePhases(md)
    expect(ps[0].id).toBe('phase-alpha')
    expect(ps[0].name).toBe('investigate')
  })

  it('detects [x] as done (lowercase)', () => {
    const md = `## Phase 1: x
- [x] T1: a
- [ ] T2: b
`
    const ps = parsePhases(md)
    expect(ps[0].tasks[0].done).toBe(true)
    expect(ps[0].tasks[1].done).toBe(false)
    expect(ps[0].status).toBe('in-progress')
  })

  it('detects [X] as done (uppercase)', () => {
    const md = `## Phase 1: x
- [X] T1: a
`
    expect(parsePhases(md)[0].tasks[0].done).toBe(true)
  })

  it('returns status="done" when all tasks done', () => {
    const md = `## Phase 1: x
- [x] T1: a
- [x] T2: b
`
    expect(parsePhases(md)[0].status).toBe('done')
  })

  it('returns status="pending" when no tasks done', () => {
    const md = `## Phase 1: x
- [ ] T1: a
- [ ] T2: b
`
    expect(parsePhases(md)[0].status).toBe('pending')
  })

  it('parses tasks without explicit T<id> (auto IDs)', () => {
    const md = `## Phase 1: x
- [ ] do thing one
- [ ] do thing two
`
    const ps = parsePhases(md)
    expect(ps[0].tasks[0].id).toBe('T1')
    expect(ps[0].tasks[0].description).toBe('do thing one')
    expect(ps[0].tasks[1].id).toBe('T2')
  })

  it('parses multiple phases', () => {
    const md = `## Phase 1: setup
- [x] T1: install
## Phase 2: execute
- [ ] T1: run
- [ ] T2: verify
`
    const ps = parsePhases(md)
    expect(ps).toHaveLength(2)
    expect(ps[0].status).toBe('done')
    expect(ps[1].status).toBe('pending')
  })

  it('skips non-list lines between phase header and tasks', () => {
    const md = `## Phase 1: x

Description prose here.

- [ ] T1: a
`
    expect(parsePhases(md)[0].tasks).toHaveLength(1)
  })

  it('phaseDoneFromTasks is true only when all tasks done AND there is at least one task', () => {
    expect(phaseDoneFromTasks({ id: 'p', name: 'p', tasks: [], status: 'pending' })).toBe(false)
    expect(phaseDoneFromTasks({
      id: 'p', name: 'p',
      tasks: [{ id: 'T1', description: 'a', done: true }],
      status: 'done',
    })).toBe(true)
    expect(phaseDoneFromTasks({
      id: 'p', name: 'p',
      tasks: [{ id: 'T1', description: 'a', done: true }, { id: 'T2', description: 'b', done: false }],
      status: 'in-progress',
    })).toBe(false)
  })

  it('currentPhase returns first non-done phase', () => {
    const phases = parsePhases(`## Phase 1: a
- [x] T1: a
## Phase 2: b
- [ ] T1: b
## Phase 3: c
- [ ] T1: c
`)
    expect(currentPhase(phases)?.id).toBe('phase-2')
  })

  it('currentPhase returns null when all phases done', () => {
    const phases = parsePhases(`## Phase 1: a
- [x] T1: a
`)
    expect(currentPhase(phases)).toBeNull()
  })

  it('currentPhase returns null when phases is empty', () => {
    expect(currentPhase([])).toBeNull()
  })

  // Edge cases
  it('handles CRLF line endings', () => {
    const md = `## Phase 1: x\r\n- [ ] T1: a\r\n`
    expect(parsePhases(md)[0].tasks[0].id).toBe('T1')
  })

  it('handles trailing whitespace on task lines', () => {
    const md = `## Phase 1: x
- [ ] T1: a
`
    expect(parsePhases(md)[0].tasks[0].description).toBe('a')
  })

  it('handles indented task lines (up to 4 spaces)', () => {
    const md = `## Phase 1: x
    - [ ] T1: indented task
`
    expect(parsePhases(md)[0].tasks).toHaveLength(1)
  })

  it('ignores tasks before the first phase header', () => {
    const md = `- [ ] orphan one
## Phase 1: x
- [ ] T1: real
`
    expect(parsePhases(md)[0].tasks).toHaveLength(1)
  })

  it('handles deeply numeric phase ids', () => {
    expect(parsePhases('## Phase 99: nines\n- [ ] T1: x\n')[0].id).toBe('phase-99')
  })

  it('keeps task ID order stable across mixed explicit/auto IDs', () => {
    const md = `## Phase 1: x
- [ ] T5: explicit five
- [ ] auto next
- [ ] T7: explicit seven
`
    const tasks = parsePhases(md)[0].tasks
    expect(tasks[0].id).toBe('T5')
    expect(tasks[1].id).toBe('T2')
    expect(tasks[2].id).toBe('T7')
  })

  it('auto-ID counter resets between phases', () => {
    const md = `## Phase 1: a
- [ ] first
- [ ] second
## Phase 2: b
- [ ] third
- [ ] fourth
`
    const ps = parsePhases(md)
    expect(ps[0].tasks.map((t) => t.id)).toEqual(['T1', 'T2'])
    expect(ps[1].tasks.map((t) => t.id)).toEqual(['T1', 'T2'])
  })
})

describe('parsePhases edge cases', () => {
  it('handles deeply numeric phase ids', () => {
    expect(parsePhases('## Phase 99: nines\n- [ ] T1: x\n')[0].id).toBe('phase-99')
  })

  it('parses tasks with mixed casing of explicit T<id>', () => {
    const md = `## Phase 1: x
- [ ] T1: first
- [ ] T2: second
`
    const ts = parsePhases(md)[0].tasks
    expect(ts.map((t) => t.id)).toEqual(['T1', 'T2'])
  })

  it('handles phases with zero tasks (status="pending")', () => {
    const md = `## Phase 1: empty
## Phase 2: also empty
`
    const ps = parsePhases(md)
    expect(ps).toHaveLength(2)
    expect(ps[0].tasks).toEqual([])
    expect(ps[0].status).toBe('pending')
    expect(ps[1].status).toBe('pending')
  })

  it('handles phase header followed immediately by next phase header', () => {
    const md = `## Phase 1: a
## Phase 2: b
- [ ] T1: only-in-2
`
    const ps = parsePhases(md)
    expect(ps).toHaveLength(2)
    expect(ps[0].tasks).toEqual([])
    expect(ps[1].tasks).toHaveLength(1)
  })

  it('preserves task order even when CRLF + tab indentation are mixed', () => {
    const md = `## Phase 1: x\r\n- [ ] T1: a\r\n  - [ ] T2: indented\r\n`
    const ps = parsePhases(md)
    expect(ps[0].tasks).toHaveLength(2)
    expect(ps[0].tasks[0].id).toBe('T1')
    expect(ps[0].tasks[1].id).toBe('T2')
  })

  it('treats whitespace-only plan as empty', () => {
    expect(parsePhases('   \n\n   \n')).toEqual([])
  })

  it('strips leading whitespace from task description', () => {
    const md = `## Phase 1: x
- [ ]    T1: spaced
`
    const ps = parsePhases(md)
    expect(ps[0].tasks[0].description).toBe('spaced')
  })
})
