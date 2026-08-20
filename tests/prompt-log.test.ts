import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLog, sentTextOf, type NewPrompt } from '../src/main/prompt-log'

let dir: string
let log: PromptLog

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'promptlog-'))
  log = new PromptLog(join(dir, 'prompts.db'))
})
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
})

function entry(over: Partial<NewPrompt> = {}): NewPrompt {
  return {
    sentAt: 1_700_000_000_000,
    targets: ['api (Claude)'],
    projects: ['D:/proj/api'],
    originalText: 'fix teh login bug',
    refinedText: 'Fix the login bug.',
    model: 'nvidia/nemotron-3.5-lightning',
    refineMs: 1080,
    ok: true,
    ...over,
  }
}

describe('PromptLog', () => {
  it('round-trips a refined broadcast', async () => {
    const id = await log.add(entry())
    expect(id).toBeGreaterThan(0)
    const [row] = await log.list()
    expect(row.originalText).toBe('fix teh login bug')
    expect(row.refinedText).toBe('Fix the login bug.')
    expect(row.targets).toEqual(['api (Claude)'])
    expect(row.projects).toEqual(['D:/proj/api'])
    expect(row.model).toBe('nvidia/nemotron-3.5-lightning')
    expect(row.refineMs).toBe(1080)
    expect(row.ok).toBe(true)
  })

  // Sent as-is: the original must still be recorded, and refinedText stays null so the
  // history can distinguish 'not refined' from 'refined to the same words'.
  it('records an unrefined send with a null rewrite', async () => {
    await log.add(entry({ refinedText: null, model: null, refineMs: null }))
    const [row] = await log.list()
    expect(row.refinedText).toBeNull()
    expect(row.model).toBeNull()
    expect(sentTextOf(row)).toBe('fix teh login bug')
  })

  it('reports the refined text as what was actually sent', () => {
    expect(sentTextOf({ originalText: 'raw', refinedText: 'polished' })).toBe('polished')
    expect(sentTextOf({ originalText: 'raw', refinedText: null })).toBe('raw')
  })

  it('returns newest first', async () => {
    await log.add(entry({ sentAt: 1000, originalText: 'older' }))
    await log.add(entry({ sentAt: 2000, originalText: 'newer' }))
    const rows = await log.list()
    expect(rows.map((r) => r.originalText)).toEqual(['newer', 'older'])
  })

  it('paginates', async () => {
    for (let i = 0; i < 5; i++) await log.add(entry({ sentAt: 1000 + i, originalText: `p${i}` }))
    expect((await log.list(2)).map((r) => r.originalText)).toEqual(['p4', 'p3'])
    expect((await log.list(2, 2)).map((r) => r.originalText)).toEqual(['p2', 'p1'])
  })

  it('deletes one and clears all', async () => {
    const a = await log.add(entry({ originalText: 'a' }))
    await log.add(entry({ originalText: 'b' }))
    await log.remove(a)
    expect((await log.list()).map((r) => r.originalText)).toEqual(['b'])
    await log.clear()
    expect(await log.count()).toBe(0)
  })

  // Unbounded growth would slow every write, since sql.js rewrites the whole file.
  it('prunes to the row cap, keeping the newest', async () => {
    for (let i = 0; i < 520; i++) await log.add(entry({ sentAt: 1000 + i, originalText: `p${i}` }))
    expect(await log.count()).toBe(500)
    const rows = await log.list(1)
    expect(rows[0].originalText).toBe('p519')
  }, 60_000)

  it('survives a multi-target send and reopening the file', async () => {
    await log.add(entry({ targets: ['api (Claude)', 'web (Codex)'], projects: ['D:/a', 'D:/b'] }))
    const reopened = new PromptLog(join(dir, 'prompts.db'))
    const [row] = await reopened.list()
    expect(row.targets).toHaveLength(2)
    expect(row.projects).toEqual(['D:/a', 'D:/b'])
  })
})
