import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  readArtifact, writeArtifact, markApproved, markUnapproved,
  incrementRefineCount, readState, writeState, reconcile,
  appendSpecUpdate,
} from '../src/main/autopilot-pro/artifacts'
import { readFileSync as rfs } from 'fs'

const TMP = join(__dirname, '.tmp-autopilot-pro-artifacts')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('autopilot-pro artifacts', () => {
  describe('readArtifact', () => {
    it('returns null content + null sha256 when missing', () => {
      const r = readArtifact(TMP, 'spec')
      expect(r.content).toBeNull()
      expect(r.sha256).toBeNull()
    })
  })

  describe('writeArtifact + readArtifact', () => {
    it('round-trips spec content with sha256', () => {
      writeArtifact(TMP, 'spec', '# hello\nworld')
      const r = readArtifact(TMP, 'spec')
      expect(r.content).toBe('# hello\nworld')
      expect(r.sha256).toMatch(/^[a-f0-9]{64}$/)
    })

    it('round-trips plan + impl-doc + review with phase scoping', () => {
      writeArtifact(TMP, 'plan', '# plan')
      writeArtifact(TMP, 'impl-doc', '# m1 impl', 'm1')
      writeArtifact(TMP, 'review', '# m1 review', 'm1')
      expect(readArtifact(TMP, 'plan').content).toBe('# plan')
      expect(readArtifact(TMP, 'impl-doc', 'm1').content).toBe('# m1 impl')
      expect(readArtifact(TMP, 'review', 'm1').content).toBe('# m1 review')
    })

    it('throws when impl-doc / review used without phaseId', () => {
      expect(() => writeArtifact(TMP, 'impl-doc', 'x')).toThrow()
      expect(() => readArtifact(TMP, 'review')).toThrow()
    })

    it('round-trips final-review artifact at .autopilot-pro/final-review.md', () => {
      writeArtifact(TMP, 'final-review', '# Final Review\n\nAll phases shipped.\n')
      expect(rfs(join(TMP, '.autopilot-pro', 'final-review.md'), 'utf-8')).toContain('All phases shipped')
      expect(readArtifact(TMP, 'final-review').content).toContain('Final Review')
    })
  })

  describe('approval state', () => {
    it('writeArtifact registers the artifact unapproved', () => {
      writeArtifact(TMP, 'spec', 'a')
      const s = readState(TMP)
      expect(s['spec.md']?.approved).toBe(false)
      expect(s['spec.md']?.refineCount).toBe(0)
    })

    it('markApproved flips approved + sets approvedAt', () => {
      writeArtifact(TMP, 'spec', 'a')
      markApproved(TMP, 'spec')
      const s = readState(TMP)
      expect(s['spec.md']?.approved).toBe(true)
      expect(typeof s['spec.md']?.approvedAt).toBe('number')
    })

    it('rewriting an approved artifact with same content keeps approval', () => {
      writeArtifact(TMP, 'spec', 'a')
      markApproved(TMP, 'spec')
      writeArtifact(TMP, 'spec', 'a')
      const s = readState(TMP)
      expect(s['spec.md']?.approved).toBe(true)
    })

    it('rewriting an approved artifact with different content auto-unapproves', () => {
      writeArtifact(TMP, 'spec', 'a')
      markApproved(TMP, 'spec')
      writeArtifact(TMP, 'spec', 'b')
      const s = readState(TMP)
      expect(s['spec.md']?.approved).toBe(false)
      expect(s['spec.md']?.approvedAt).toBeNull()
    })

    it('markUnapproved flips approved without losing refineCount', () => {
      writeArtifact(TMP, 'spec', 'a')
      markApproved(TMP, 'spec')
      incrementRefineCount(TMP, 'spec')
      markUnapproved(TMP, 'spec')
      const s = readState(TMP)
      expect(s['spec.md']?.approved).toBe(false)
      expect(s['spec.md']?.refineCount).toBe(1)
    })
  })

  describe('refine count', () => {
    it('incrementRefineCount returns the new value and persists', () => {
      writeArtifact(TMP, 'spec', 'a')
      expect(incrementRefineCount(TMP, 'spec')).toBe(1)
      expect(incrementRefineCount(TMP, 'spec')).toBe(2)
      expect(incrementRefineCount(TMP, 'spec')).toBe(3)
      const s = readState(TMP)
      expect(s['spec.md']?.refineCount).toBe(3)
    })
  })

  describe('readState resilience', () => {
    it('returns empty object when state.json is missing', () => {
      expect(readState(TMP)).toEqual({})
    })

    it('returns empty object when state.json is corrupt JSON', () => {
      mkdirSync(join(TMP, '.autopilot-pro'), { recursive: true })
      writeFileSync(join(TMP, '.autopilot-pro', 'state.json'), 'not json')
      expect(readState(TMP)).toEqual({})
    })

    it('writeState atomically writes and survives a re-read', () => {
      writeState(TMP, { 'spec.md': { path: 'spec.md', kind: 'spec', approved: true, sha256: 'x', approvedAt: 1, refineCount: 0 } })
      expect(existsSync(join(TMP, '.autopilot-pro', 'state.json'))).toBe(true)
      expect(readState(TMP)['spec.md']?.approved).toBe(true)
      // Tmp file should have been cleaned up.
      expect(existsSync(join(TMP, '.autopilot-pro', 'state.json.tmp'))).toBe(false)
    })
  })

  describe('reconcile', () => {
    it('auto-unapproves entries whose file hash drifted', () => {
      writeArtifact(TMP, 'spec', 'a')
      markApproved(TMP, 'spec')
      // External edit (e.g. user opened the file in their editor).
      writeFileSync(join(TMP, '.autopilot-pro', 'spec.md'), 'tampered')
      const reconciled = reconcile(TMP)
      expect(reconciled['spec.md']?.approved).toBe(false)
      expect(reconciled['spec.md']?.approvedAt).toBeNull()
    })

    it('preserves approval when file hash matches the recorded one', () => {
      writeArtifact(TMP, 'spec', 'a')
      markApproved(TMP, 'spec')
      const reconciled = reconcile(TMP)
      expect(reconciled['spec.md']?.approved).toBe(true)
    })
  })
})

describe('appendSpecUpdate', () => {
  it('appends a "## Updates (<ts>)" section to spec.md', () => {
    writeArtifact(TMP, 'spec', '# original\n')
    markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, 'add cancel endpoint')
    const spec = rfs(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')
    expect(spec).toMatch(/^# original/)
    expect(spec).toMatch(/## Updates \(\d{4}-\d{2}-\d{2}T/)
    expect(spec).toContain('add cancel endpoint')
  })

  it('appends a one-line entry to spec-changelog.md', () => {
    writeArtifact(TMP, 'spec', '# spec\n'); markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, 'first delta')
    appendSpecUpdate(TMP, 'second delta with more text that should be truncated to 100 chars in the changelog line ' + 'x'.repeat(200))
    const log = rfs(join(TMP, '.autopilot-pro', 'spec-changelog.md'), 'utf-8')
    const lines = log.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^- \d{4}-\d{2}-\d{2}T.* applied: first delta$/)
    expect(lines[1]).toMatch(/^- \d{4}-\d{2}-\d{2}T.* applied: /)
    expect(lines[1].length).toBeLessThan(200)
  })

  it('updates spec.md sha256 in state.json after append', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    const before = readState(TMP)['spec.md']?.sha256
    appendSpecUpdate(TMP, 'delta one')
    const after = readState(TMP)['spec.md']?.sha256
    expect(after).not.toBe(before)
    expect(after).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps approved=true after applying a delta', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    expect(readState(TMP)['spec.md']?.approved).toBe(true)
    appendSpecUpdate(TMP, 'delta')
    expect(readState(TMP)['spec.md']?.approved).toBe(true)
  })

  it('multiple sequential appends each add a new ## Updates section', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, 'd1')
    appendSpecUpdate(TMP, 'd2')
    appendSpecUpdate(TMP, 'd3')
    const spec = rfs(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')
    expect((spec.match(/## Updates \(/g) ?? []).length).toBe(3)
    expect(spec).toContain('d1')
    expect(spec).toContain('d2')
    expect(spec).toContain('d3')
  })

  it('flattens multi-line deltas to a single changelog line', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, 'line one\nline two\nline three')
    const log = rfs(join(TMP, '.autopilot-pro', 'spec-changelog.md'), 'utf-8')
    expect(log.trim().split('\n')).toHaveLength(1)
    expect(log).toContain('line one')
  })

  it('handles unicode in delta body', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, 'add 你好 endpoint')
    expect(rfs(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')).toContain('你好')
  })

  it('handles empty delta body without crashing', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, '')
    const spec = rfs(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')
    expect(spec).toMatch(/## Updates \(/)
  })

  it('changelog line is exactly one line even for multi-line delta', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    appendSpecUpdate(TMP, `line1
line2
line3`)
    const log = rfs(join(TMP, '.autopilot-pro', 'spec-changelog.md'), 'utf-8')
    expect(log.trim().split('\n')).toHaveLength(1)
  })

  it('flat changelog body is at most 100 chars after the prefix', () => {
    writeArtifact(TMP, 'spec', '# v1\n'); markApproved(TMP, 'spec')
    const longDelta = 'x'.repeat(500)
    appendSpecUpdate(TMP, longDelta)
    const log = rfs(join(TMP, '.autopilot-pro', 'spec-changelog.md'), 'utf-8').trim()
    const idx = log.indexOf(' applied: ') + ' applied: '.length
    expect(log.slice(idx).length).toBeLessThanOrEqual(100)
  })
})

describe('relativePath/inferArtifactKind for ADR (Wave 1.5)', () => {
  it("relativePath('adr', '0001-foo') returns 'docs/decisions/0001-foo.md'", () => {
    // The relativePath function is internal; test via writeArtifact + readArtifact
    writeArtifact(TMP, 'adr', '# ADR-0001: Foo\n\n## Status\nAccepted\n\n## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n', '0001-foo')
    expect(existsSync(join(TMP, 'docs', 'decisions', '0001-foo.md'))).toBe(true)
    expect(readArtifact(TMP, 'adr', '0001-foo').content).toContain('ADR-0001')
  })

  it('throws when ADR used without phaseId', () => {
    expect(() => writeArtifact(TMP, 'adr', 'x')).toThrow()
  })
})

describe('state.json corrupt-file backups (Wave 3.6)', () => {
  it('backs up state.json before resetting on parse error', () => {
    mkdirSync(join(TMP, '.autopilot-pro'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot-pro', 'state.json'), 'this is not json {')
    const result = readState(TMP)
    expect(result).toEqual({})
    const files = readdirSync(join(TMP, '.autopilot-pro'))
    const backups = files.filter((f) => f.startsWith('state.json.corrupt-'))
    expect(backups.length).toBe(1)
  })

  it('backs up state.json on schema-invalid input', () => {
    mkdirSync(join(TMP, '.autopilot-pro'), { recursive: true })
    // Valid JSON but wrong shape: entries missing required fields.
    writeFileSync(join(TMP, '.autopilot-pro', 'state.json'),
      JSON.stringify({ 'spec.md': { foo: 'bar', refineCount: 'not a number' } }))
    const result = readState(TMP)
    expect(result).toEqual({})
    const files = readdirSync(join(TMP, '.autopilot-pro'))
    const backups = files.filter((f) => f.startsWith('state.json.corrupt-'))
    expect(backups.length).toBe(1)
  })

  it('does not back up valid state.json', () => {
    writeArtifact(TMP, 'spec', '# spec')
    markApproved(TMP, 'spec')
    const result = readState(TMP)
    expect(result['spec.md']?.approved).toBe(true)
    const files = readdirSync(join(TMP, '.autopilot-pro'))
    const backups = files.filter((f) => f.startsWith('state.json.corrupt-'))
    expect(backups.length).toBe(0)
  })
})
