import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  readArtifact, writeArtifact, markApproved, markUnapproved,
  incrementRefineCount, readState, writeState, reconcile,
} from '../src/main/autopilot-pro/artifacts'

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
