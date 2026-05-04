import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendCouncilDecision,
  councilPath,
  readRecentCouncilDecisions,
  writeReviewPacketFiles,
} from '../src/main/autopilot-council/state-files'

let dir: string | null = null

function project(): string {
  dir = mkdtempSync(join(tmpdir(), 'cmdcld-council-'))
  return dir
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('council state files', () => {
  it('resolves paths inside .autopilot-council', () => {
    const root = project()
    expect(councilPath(root, 'decisions.md')).toBe(join(root, '.autopilot-council', 'decisions.md'))
  })

  it('rejects paths outside .autopilot-council', () => {
    const root = project()
    expect(() => councilPath(root, '../outside.txt')).toThrow()
    expect(() => writeReviewPacketFiles(root, '../escape', '# request', '{}')).toThrow()
  })

  it('writes packet request and response files', () => {
    const root = project()
    writeReviewPacketFiles(root, '001-spec-review', '# request', '{"verdict":"approve"}')
    expect(readFileSync(councilPath(root, 'packets/001-spec-review.request.md'), 'utf-8')).toBe('# request')
    expect(readFileSync(councilPath(root, 'packets/001-spec-review.response.json'), 'utf-8')).toBe('{"verdict":"approve"}')
  })

  it('appends and reads recent decisions', () => {
    const root = project()
    appendCouncilDecision(root, 'first')
    appendCouncilDecision(root, 'second')
    expect(readRecentCouncilDecisions(root)).toEqual([
      expect.stringContaining('first'),
      expect.stringContaining('second'),
    ])
  })
})
