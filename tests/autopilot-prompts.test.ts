import { describe, it, expect } from 'vitest'
import { DOER_SYSTEM_PROMPT, buildDecisionPrompt, buildDoerSystemPrompt, buildExecutionKickoff, buildWizardKickoff, DEBUG_SYSTEM_PROMPT, buildDebugPrompt } from '../src/main/autopilot/prompts'
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

  it('defines the file-based control channel as primary', () => {
    expect(DOER_SYSTEM_PROMPT).toContain('.autopilot/outbox/marker.json')
    expect(DOER_SYSTEM_PROMPT).toContain('.autopilot/inbox/reply.txt')
    expect(DOER_SYSTEM_PROMPT).toMatch(/primary machine channel is file-based/i)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Terminal markers are a human-visible fallback/i)
    expect(DOER_SYSTEM_PROMPT).toMatch(/schemaVersion/)
  })

  it('mentions the boundary block on subgoals', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary\.allowed/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary\.forbidden/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/STUCK.*boundary violation/i)
  })

  it('mentions learnings.md as append-only', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/learnings\.md/)
  })

  it('forbids moving the orchestrator state directory during scaffolding', () => {
    expect(DOER_SYSTEM_PROMPT).toContain('ORCHESTRATOR STATE LOCK')
    expect(DOER_SYSTEM_PROMPT).toMatch(/never move, rename, delete/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/create-next-app refuses/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Manually create the needed project files/)
  })

  it('mentions steering files as authoritative', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/tech\.md|structure\.md/)
  })

  it('mentions EARS-form acceptance evaluation', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/WHEN .* SHALL/)
  })

  it('pins the strict Classic parser format for goal and milestone files', () => {
    expect(DOER_SYSTEM_PROMPT).toContain('STRICT CLASSIC ARTIFACT FORMAT')
    expect(DOER_SYSTEM_PROMPT).toContain('Required .autopilot/goal.md template')
    expect(DOER_SYSTEM_PROMPT).toContain('# Goal')
    expect(DOER_SYSTEM_PROMPT).toContain('## Acceptance')
    expect(DOER_SYSTEM_PROMPT).toContain('# Milestone m1 — <name>')
    expect(DOER_SYSTEM_PROMPT).toContain('- [ ] s1: <description>')
    expect(DOER_SYSTEM_PROMPT).toMatch(/Do not write "# Goal: <name>"/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Do not use "### s1"/)
  })

  it('adds a Codex runtime policy that forbids local commits', () => {
    const codexPrompt = buildDoerSystemPrompt('codex')
    expect(codexPrompt).toMatch(/Codex runtime guardrails/i)
    expect(codexPrompt).toMatch(/DO NOT commit/i)
    expect(codexPrompt).toMatch(/proposed commit/i)
  })

  it('switches Classic to no-git policy when the project root has no git metadata', () => {
    const prompt = buildDoerSystemPrompt('claude', { gitAvailable: false })
    expect(prompt).toMatch(/NO-GIT WORKSPACE GUARDRAILS/)
    expect(prompt).toMatch(/DO NOT run git add, git commit, git tag, or git push/)
    expect(prompt).toMatch(/proposed commit message/)
  })

  it('builds an execution kickoff that starts the current milestone immediately', () => {
    const kickoff = buildExecutionKickoff('m1', false)
    expect(kickoff).toMatch(/Begin Phase 2 execution now/)
    expect(kickoff).toMatch(/\.autopilot\/milestones\/m1\.md/)
    expect(kickoff).toMatch(/Do NOT run git commands/)
    expect(kickoff).toMatch(/\[ORCH:PROGRESS\]/)
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

// ----- buildWizardKickoff tests -----

it('buildWizardKickoff mentions EARS form', () => {
  const k = buildWizardKickoff('idea')
  expect(k).toMatch(/EARS|WHEN .* SHALL/)
})

it('buildWizardKickoff mentions Mermaid for non-trivial milestones', () => {
  const k = buildWizardKickoff('idea')
  expect(k).toMatch(/[Mm]ermaid/)
})

it('buildWizardKickoff mentions boundary blocks as optional per subgoal', () => {
  const k = buildWizardKickoff('idea')
  expect(k).toMatch(/boundary/i)
})

it('buildWizardKickoff suggests optional steering files', () => {
  const k = buildWizardKickoff('idea')
  expect(k).toMatch(/tech\.md|structure\.md/)
})

it('buildWizardKickoff still includes the user idea verbatim', () => {
  const k = buildWizardKickoff('a small Express server')
  expect(k).toContain('a small Express server')
})

it('buildWizardKickoff includes the strict Classic artifact contract', () => {
  const k = buildWizardKickoff('idea')
  expect(k).toContain('STRICT CLASSIC ARTIFACT FORMAT')
  expect(k).toContain('The goal file MUST start with exactly "# Goal"')
  expect(k).toContain('Subgoals MUST be checkbox bullets')
  expect(k).toContain('Before emitting [ORCH:GOAL_READY]')
})

// ----- DEBUG prompt tests -----

it('DEBUG_SYSTEM_PROMPT teaches retry|block|human classification', () => {
  expect(DEBUG_SYSTEM_PROMPT).toMatch(/retry/)
  expect(DEBUG_SYSTEM_PROMPT).toMatch(/block/)
  expect(DEBUG_SYSTEM_PROMPT).toMatch(/human/)
})

it('buildDebugPrompt has compact user content (no recent log, no checklist)', () => {
  const out = buildDebugPrompt({
    goal,
    currentMilestoneId: 'm1',
    lastSnapshot: snap,
    trigger: 'stuck',
  })
  expect(out.user).toMatch(/STUCK|stuck/i)
  expect(out.user).toMatch(/g/)              // goal text included
  expect(out.user).not.toMatch(/CHECKLIST/)  // checklist intentionally omitted
  expect(out.user).not.toMatch(/RECENT ACTIVITY/)
})

describe('Classic GROUNDING (Wave 3.5)', () => {
  it('DOER_SYSTEM_PROMPT contains the GROUND PLANNING IN REAL CODE block', () => {
    expect(DOER_SYSTEM_PROMPT).toContain('GROUND PLANNING IN REAL CODE')
  })

  it('DOER_SYSTEM_PROMPT mentions the Repository impact section', () => {
    expect(DOER_SYSTEM_PROMPT).toContain('Repository impact')
  })

  it('buildWizardKickoff includes the scan-first instruction', () => {
    const k = buildWizardKickoff('build a backup tool')
    expect(k).toMatch(/Before writing goal\.md/i)
    expect(k).toMatch(/Glob/)
    expect(k).toContain('Repository impact')
  })
})
