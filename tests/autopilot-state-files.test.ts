import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  readGoal, writeGoal, readMilestones, writeMilestone, appendLog,
} from '../src/main/autopilot/state-files'
import type { Goal, Milestone, ActivityEntry } from '../src/main/autopilot/types'

const TMP = join(__dirname, '.tmp-autopilot-state-files')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('autopilot state-files', () => {
  describe('goal.md', () => {
    it('returns null when goal.md is missing', () => {
      expect(readGoal(TMP)).toBe(null)
    })

    it('writes and reads back a goal', () => {
      const goal: Goal = {
        goal: 'Build a small Express health endpoint',
        nonGoals: ['No auth', 'No persistence'],
        acceptance: [
          { kind: 'shell', value: 'npm test' },
          { kind: 'judge', value: 'Does the README explain how to run it?' },
        ],
        constraints: { maxIterations: 40, maxApiCostUsd: 1.0, maxDoerOutputPerReset: 60000 },
      }
      writeGoal(TMP, goal)
      const back = readGoal(TMP)
      expect(back).toEqual(goal)
    })

    it('returns null for malformed goal.md', () => {
      mkdirSync(join(TMP, '.autopilot'), { recursive: true })
      writeFileSync(join(TMP, '.autopilot/goal.md'), 'this is not the right format')
      expect(readGoal(TMP)).toBe(null)
    })
  })

  describe('milestones', () => {
    it('returns empty list when milestones folder missing', () => {
      expect(readMilestones(TMP)).toEqual([])
    })

    it('writes and reads back a milestone', () => {
      const m: Milestone = {
        id: 'm1',
        name: 'Scaffolding',
        status: 'pending',
        subgoals: [
          { id: 's1', description: 'Init npm', status: 'pending', shell: 'test -f package.json' },
          { id: 's2', description: 'README', status: 'pending', judge: 'Is the README clear?' },
        ],
        notes: '',
      }
      writeMilestone(TMP, m)
      const list = readMilestones(TMP)
      expect(list).toHaveLength(1)
      expect(list[0]).toEqual(m)
    })

    it('returns milestones sorted by id', () => {
      writeMilestone(TMP, { id: 'm2', name: 'B', status: 'pending', subgoals: [], notes: '' })
      writeMilestone(TMP, { id: 'm1', name: 'A', status: 'pending', subgoals: [], notes: '' })
      const list = readMilestones(TMP)
      expect(list.map((m) => m.id)).toEqual(['m1', 'm2'])
    })
  })

  describe('log.md', () => {
    it('appends entries in order', () => {
      const e1: ActivityEntry = { at: 1000, kind: 'orchestrator-reply', summary: 'Sent: continue' }
      const e2: ActivityEntry = { at: 2000, kind: 'doer-marker', summary: 'PROGRESS m1/s1 done' }
      appendLog(TMP, e1)
      appendLog(TMP, e2)
      const text = readFileSync(join(TMP, '.autopilot/log.md'), 'utf-8')
      expect(text).toContain('orchestrator-reply')
      expect(text).toContain('doer-marker')
      expect(text.indexOf('orchestrator-reply')).toBeLessThan(text.indexOf('doer-marker'))
    })
  })

  describe('directory creation', () => {
    it('creates .autopilot/milestones/ if missing on writeMilestone', () => {
      writeMilestone(TMP, { id: 'm1', name: 'X', status: 'pending', subgoals: [], notes: '' })
      expect(existsSync(join(TMP, '.autopilot/milestones'))).toBe(true)
    })
  })
})
