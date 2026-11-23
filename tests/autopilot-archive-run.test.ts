import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { archivePreviousRun } from '../src/main/autopilot-shared/archive-run'

// "Start fresh" with a new idea, in a folder that had a run before, resumed
// the old run: its goal and milestones were still on disk, so the new idea
// was never used. Starting fresh now sets the old run aside first.
describe('archivePreviousRun', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ap-archive-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  const dir = () => join(root, '.autopilot')
  const seed = () => {
    mkdirSync(join(dir(), 'milestones'), { recursive: true })
    mkdirSync(join(dir(), 'outbox'), { recursive: true })
    writeFileSync(join(dir(), 'goal.md'), '# old goal')
    writeFileSync(join(dir(), 'milestones', 'm1.md'), '# m1')
    writeFileSync(join(dir(), 'runtime.json'), '{}')
    writeFileSync(join(dir(), 'outbox', 'marker.json'), '{}')
  }

  it('does nothing when there was no earlier run', () => {
    expect(archivePreviousRun(root, '.autopilot')).toBeNull()
    expect(existsSync(dir())).toBe(false)
  })

  it('moves the earlier run into an archive folder and leaves the directory clean', () => {
    seed()
    const archived = archivePreviousRun(root, '.autopilot', () => new Date('2026-11-23T08:09:10.000Z'))
    expect(archived).toBe(join(dir(), 'archive', '2026-11-23T08-09-10-000Z'))
    expect(readdirSync(dir())).toEqual(['archive'])
    expect(readFileSync(join(archived!, 'goal.md'), 'utf-8')).toBe('# old goal')
    expect(existsSync(join(archived!, 'milestones', 'm1.md'))).toBe(true)
    expect(existsSync(join(archived!, 'outbox', 'marker.json'))).toBe(true)
  })

  it('keeps what the project has learned across runs', () => {
    seed()
    writeFileSync(join(dir(), 'learnings.md'), '- use pnpm')
    archivePreviousRun(root, '.autopilot')
    expect(readFileSync(join(dir(), 'learnings.md'), 'utf-8')).toBe('- use pnpm')
  })

  it('archives a second time beside the first, never over it', () => {
    seed()
    const first = archivePreviousRun(root, '.autopilot', () => new Date('2026-11-23T08:00:00.000Z'))
    seed()
    const second = archivePreviousRun(root, '.autopilot', () => new Date('2026-11-23T08:00:00.000Z'))
    expect(second).not.toBe(first)
    expect(readdirSync(join(dir(), 'archive'))).toHaveLength(2)
  })

  it('does nothing when only the archive and learnings are there', () => {
    seed()
    writeFileSync(join(dir(), 'learnings.md'), 'x')
    archivePreviousRun(root, '.autopilot')
    expect(archivePreviousRun(root, '.autopilot')).toBeNull()
  })
})
