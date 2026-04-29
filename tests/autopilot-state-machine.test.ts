import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { AutopilotStateMachine } from '../src/main/autopilot/state-machine'
import type { ApiClient, AutopilotOptions, Goal, Milestone, ApiUsage, DecideResult } from '../src/main/autopilot/types'
import { writeGoal, writeMilestone } from '../src/main/autopilot/state-files'

const TMP = join(__dirname, '.tmp-autopilot-sm')

function makeApi(plan: () => DecideResult): ApiClient {
  return {
    decide: vi.fn(async () => ({ result: plan(), usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage })),
    estimateCost: () => 0.001,
  }
}

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('AutopilotStateMachine', () => {
  it('starts in wizard phase when no goal.md exists', async () => {
    const sm = makeSm('idea text', makeApi(() => ({ kind: 'reply', text: 'continue' })))
    await sm.start()
    expect(sm.state.phase).toBe('wizard')
  })

  it('transitions to awaiting_goal_review on GOAL_READY marker', async () => {
    writeGoal(TMP, makeGoal())
    writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForPhase(sm, 'awaiting_goal_review')
    expect(sm.state.phase).toBe('awaiting_goal_review')
  })

  it('approveGoal moves to executing', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForPhase(sm, 'awaiting_goal_review')
    sm.approveGoal()
    expect(sm.state.phase).toBe('executing')
  })

  it('escalates on STUCK marker', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.approveGoal()
    sm.feedPty('[ORCH:STUCK] cannot find git\n')
    await waitForPhase(sm, 'escalated')
    expect(sm.state.phase).toBe('escalated')
    expect(sm.state.escalationReason).toContain('cannot find git')
  })

  it('updates checklist on PROGRESS done', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.approveGoal()
    sm.feedPty('[ORCH:PROGRESS] m1/s1 done\n')
    await waitForFlush()
    const m = sm.state.milestones.find((mm) => mm.id === 'm1')!
    const s = m.subgoals.find((ss) => ss.id === 's1')!
    expect(s.status).toBe('done')
  })

  it('halts on cost cap', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const expensiveApi: ApiClient = {
      decide: vi.fn(async () => ({ result: { kind: 'reply' as const, text: 'go' }, usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1 } as ApiUsage })),
      estimateCost: () => 100, // each call costs $100
    }
    const sm = makeSm('idea', expensiveApi)
    await sm.start()
    sm.approveGoal()
    sm.feedPty('[ORCH:WAITING] q\n')
    await waitForPhase(sm, 'paused')
    expect(sm.state.phase).toBe('paused')
  })
})

function makeSm(idea: string, api: ApiClient): AutopilotStateMachine {
  const opts: AutopilotOptions = {
    terminalId: 't',
    projectPath: TMP,
    freeTextIdea: idea,
    costCapUsd: 1.0,
    maxIterations: 40,
    apiProvider: 'anthropic',
    apiKey: 'test',
    plannerModel: 'claude-sonnet-4-6',
    writeToPty: () => {},
    onPtyData: () => () => {},
    onUpdate: () => {},
  }
  return new AutopilotStateMachine(opts, api, 10) // 10ms idle for fast test settling
}

function makeGoal(): Goal {
  return {
    goal: 'X', nonGoals: [], acceptance: [],
    constraints: { maxIterations: 40, maxApiCostUsd: 1.0, maxDoerOutputPerReset: 60000 },
  }
}

function makeMilestone(): Milestone {
  return {
    id: 'm1', name: 'A', status: 'pending', notes: '',
    subgoals: [{ id: 's1', description: 'a', status: 'pending' }],
  }
}

async function waitForPhase(sm: AutopilotStateMachine, phase: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (sm.state.phase !== phase) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for phase ${phase}, got ${sm.state.phase}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function waitForFlush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50))
}
