import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  readGoal, writeGoal, readMilestones, writeMilestone, appendLog,
  appendLearning, readLearnings, readSteering,
} from '../src/main/autopilot/state-files'
import type { Goal, Milestone, ActivityEntry } from '../src/main/autopilot/types'

// Wave 3.4 relaxed-parser tests use their own tmp dir via a nested beforeEach/afterEach
const TMP2 = join(__dirname, '.tmp-autopilot-state-files-wave34')

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

    it('round-trips Subgoal.boundary through milestone markdown', () => {
      const m: Milestone = {
        id: 'm1',
        name: 'Auth',
        status: 'pending',
        subgoals: [
          {
            id: 's1',
            description: 'login form',
            boundary: {
              allowedFiles: ['src/auth/login.ts', 'tests/auth/login.test.ts'],
              forbiddenFiles: ['src/billing/**'],
              allowedDeps: ['zod'],
            },
            status: 'pending',
          },
          {
            id: 's2',
            description: 'no boundary on this one',
            status: 'pending',
          },
        ],
        notes: '',
      }
      writeMilestone(TMP, m)
      const read = readMilestones(TMP)
      expect(read).toHaveLength(1)
      const s1 = read[0].subgoals.find((s) => s.id === 's1')!
      expect(s1.boundary?.allowedFiles).toEqual(['src/auth/login.ts', 'tests/auth/login.test.ts'])
      expect(s1.boundary?.forbiddenFiles).toEqual(['src/billing/**'])
      expect(s1.boundary?.allowedDeps).toEqual(['zod'])
      const s2 = read[0].subgoals.find((s) => s.id === 's2')!
      expect(s2.boundary).toBeUndefined()
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

  describe('learnings', () => {
    it('appendLearning writes a single bullet line and readLearnings returns them in order', () => {
      appendLearning(TMP, 'first thing learned')
      appendLearning(TMP, 'second thing learned')
      const lines = readLearnings(TMP)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatch(/^- \d{4}-\d{2}-\d{2}T.+ first thing learned$/)
      expect(lines[1]).toMatch(/second thing learned$/)
    })

    it('readLearnings returns empty array when file is missing', () => {
      expect(readLearnings(TMP)).toEqual([])
    })
  })

  describe('steering', () => {
    it('readSteering returns nulls when files missing', () => {
      const s = readSteering(TMP)
      expect(s.tech).toBeNull()
      expect(s.structure).toBeNull()
    })

    it('readSteering reads tech.md and structure.md when present', () => {
      mkdirSync(join(TMP, '.autopilot', 'project'), { recursive: true })
      writeFileSync(join(TMP, '.autopilot', 'project', 'tech.md'), '# Tech\nNode 20, TypeScript')
      writeFileSync(join(TMP, '.autopilot', 'project', 'structure.md'), '# Structure\nsrc/, tests/')
      const s = readSteering(TMP)
      expect(s.tech).toContain('Node 20')
      expect(s.structure).toContain('src/, tests/')
    })

    it('readSteering truncates files larger than 2KB with a marker', () => {
      mkdirSync(join(TMP, '.autopilot', 'project'), { recursive: true })
      writeFileSync(join(TMP, '.autopilot', 'project', 'tech.md'), 'x'.repeat(3000))
      const s = readSteering(TMP)
      expect(s.tech!.length).toBeLessThanOrEqual(2048 + 50)  // 2KB + marker
      expect(s.tech).toContain('(truncated)')
    })
  })
})

describe('readGoal — accepted formats (Wave 3.4 relaxed parser)', () => {
  beforeEach(() => { mkdirSync(join(TMP2, '.autopilot'), { recursive: true }) })
  afterEach(() => { rmSync(TMP2, { recursive: true, force: true }) })

  it('accepts ## Goal (h2) instead of # Goal (h1)', () => {
    writeFileSync(join(TMP2, '.autopilot', 'goal.md'),
      '## Goal\n\nbuild a thing\n\n## Constraints\n- max_iterations: 40\n- max_api_cost_usd: 1.0\n- max_doer_output_per_reset: 60000\n')
    const g = readGoal(TMP2)
    expect(g).not.toBeNull()
    expect(g!.goal).toBe('build a thing')
  })

  it('accepts "## Acceptance criteria" (with the word criteria)', () => {
    writeFileSync(join(TMP2, '.autopilot', 'goal.md'),
      '# Goal\n\nbuild\n\n## Acceptance criteria\n- shell: npm test\n\n## Constraints\n- max_iterations: 40\n- max_api_cost_usd: 1.0\n- max_doer_output_per_reset: 60000\n')
    const g = readGoal(TMP2)
    expect(g!.acceptance).toEqual([{ kind: 'shell', value: 'npm test' }])
  })

  it('accepts a goal.md missing the constraints section by using defaults', () => {
    writeFileSync(join(TMP2, '.autopilot', 'goal.md'), '# Goal\n\njust a thing\n')
    const g = readGoal(TMP2)
    expect(g).not.toBeNull()
    expect(g!.constraints.maxIterations).toBe(40)
    expect(g!.constraints.maxApiCostUsd).toBe(1.0)
    expect(g!.constraints.maxDoerOutputPerReset).toBe(60000)
  })

  it('returns null only when the file is missing', () => {
    expect(readGoal(TMP2)).toBeNull()
  })

  it('parses the BackupHero-shaped goal.md fixture', () => {
    const fixture = readFileSync(join(__dirname, 'fixtures', 'backuphero-goal.md'), 'utf-8')
    writeFileSync(join(TMP2, '.autopilot', 'goal.md'), fixture)
    const g = readGoal(TMP2)
    expect(g).not.toBeNull()
    expect(g!.goal).toContain('BackupHero')
    expect(g!.nonGoals.length).toBeGreaterThan(0)
    expect(g!.acceptance.length).toBeGreaterThan(0)
    expect(g!.constraints.maxIterations).toBe(40)
  })
})
