import { describe, it, expect } from 'vitest'
import { DOER_SYSTEM_PROMPT, buildDecisionPrompt } from '../src/main/autopilot/prompts'
import type { Goal, Milestone, SettledSnapshot, ActivityEntry, ValidationCommands, SteeringDocs } from '../src/main/autopilot/types'

describe('DOER_SYSTEM_PROMPT', () => {
  it('includes ITERATION DISCIPLINE language', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/ITERATION DISCIPLINE/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/while I'm at it/)
  })

  it('includes PRE-COMMIT CHECKS with five mechanical items', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/PRE-COMMIT CHECKS/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Run the full test suite/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Run the build/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/grep/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/RED phase|failing test/i)
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary/i)
  })

  it('forbids `git add -A`, `git add .`, `git add -u`', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/git add -A/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/git add \./)
    expect(DOER_SYSTEM_PROMPT).toMatch(/git add -u/)
  })

  it('forbids committing internal .autopilot files but allows the spec files', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/state\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/log\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/learnings\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/goal\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/milestones\//)
  })

  it('describes the Status Report structured block', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/STATUS:/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/FILES_CHANGED/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/BOUNDARY_OK/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/RED_PHASE/)
  })

  it('mentions the boundary block on subgoals', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary\.allowed/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary\.forbidden/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/STUCK.*boundary violation/i)
  })

  it('mentions learnings.md as append-only', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/learnings\.md/)
  })

  it('mentions steering files as authoritative', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/tech\.md|structure\.md/)
  })

  it('mentions EARS-form acceptance evaluation', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/WHEN .* SHALL/)
  })
})

// ----- buildDecisionPrompt tests -----

const goal: Goal = {
  goal: 'g',
  nonGoals: [],
  acceptance: [],
  constraints: { maxIterations: 40, maxApiCostUsd: 1.0, maxDoerOutputPerReset: 60000 },
}
const milestones: Milestone[] = [{
  id: 'm1', name: 'a', status: 'in-progress',
  subgoals: [{ id: 's1', description: 'd', status: 'pending', boundary: { allowedFiles: ['src/foo.ts'] } }],
  notes: '',
}]
const snap: SettledSnapshot = {
  text: 'ctx',
  marker: { kind: 'WAITING', text: 'go?', raw: '[ORCH:WAITING] go?', filesChanged: ['src/x.ts'], boundaryOk: true },
  receivedAt: 0,
}
const log: ActivityEntry[] = []

it('cached prefix surfaces validation commands when present', () => {
  const validation: ValidationCommands = { test: 'npm test', build: 'npm run build' }
  const parts = buildDecisionPrompt({
    goal, milestones, currentMilestoneId: 'm1', recentLog: log, snapshot: snap,
    validation, learnings: [], steering: { tech: null, structure: null },
  })
  expect(parts.cachedGoalAndMilestones).toMatch(/VALIDATION/)
  expect(parts.cachedGoalAndMilestones).toMatch(/npm test/)
})

it('cached prefix surfaces learnings when present', () => {
  const parts = buildDecisionPrompt({
    goal, milestones, currentMilestoneId: 'm1', recentLog: log, snapshot: snap,
    validation: {}, learnings: ['- 2026-04-29 watchdog needs --no-cache'],
    steering: { tech: null, structure: null },
  })
  expect(parts.cachedGoalAndMilestones).toMatch(/LEARNINGS/)
  expect(parts.cachedGoalAndMilestones).toMatch(/watchdog/)
})

it('cached prefix surfaces steering files when present', () => {
  const parts = buildDecisionPrompt({
    goal, milestones, currentMilestoneId: 'm1', recentLog: log, snapshot: snap,
    validation: {}, learnings: [],
    steering: { tech: '# Tech\nNode 20', structure: '# Structure\nsrc/' },
  })
  expect(parts.cachedGoalAndMilestones).toMatch(/TECH STACK/)
  expect(parts.cachedGoalAndMilestones).toMatch(/Node 20/)
  expect(parts.cachedGoalAndMilestones).toMatch(/STRUCTURE/)
})

it('cached prefix mentions current subgoal boundary when defined', () => {
  const parts = buildDecisionPrompt({
    goal, milestones, currentMilestoneId: 'm1', recentLog: log, snapshot: snap,
    validation: {}, learnings: [], steering: { tech: null, structure: null },
  })
  expect(parts.cachedGoalAndMilestones).toMatch(/CURRENT SUBGOAL BOUNDARY/)
  expect(parts.cachedGoalAndMilestones).toMatch(/src\/foo\.ts/)
})

it('uncached suffix surfaces structured marker fields when present', () => {
  const parts = buildDecisionPrompt({
    goal, milestones, currentMilestoneId: 'm1', recentLog: log, snapshot: snap,
    validation: {}, learnings: [], steering: { tech: null, structure: null },
  })
  expect(parts.uncachedRecent).toMatch(/Files changed/i)
  expect(parts.uncachedRecent).toMatch(/src\/x\.ts/)
  expect(parts.uncachedRecent).toMatch(/Boundary OK/i)
})
