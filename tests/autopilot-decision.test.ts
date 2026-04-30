import { describe, it, expect, vi } from 'vitest'
import { decide } from '../src/main/autopilot/decision'
import type { ApiClient, DecideInput, DecideResult, ApiUsage, SettledSnapshot, Goal, Milestone } from '../src/main/autopilot/types'

const goal: Goal = {
  goal: 'Test goal', nonGoals: [], acceptance: [],
  constraints: { maxIterations: 40, maxApiCostUsd: 1, maxDoerOutputPerReset: 60000 },
}
const milestones: Milestone[] = [
  { id: 'm1', name: 'A', status: 'in-progress', subgoals: [
    { id: 's1', description: 'first', status: 'pending' },
  ], notes: '' },
]

function makeSnapshot(text: string): SettledSnapshot {
  return {
    text: '',
    marker: { kind: 'WAITING', text, raw: `[ORCH:WAITING] ${text}` },
    receivedAt: 0,
  }
}

function makeMockClient(plan: DecideResult, usage: ApiUsage = { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 }): ApiClient {
  return {
    decide: vi.fn(async () => ({ result: plan, usage })),
    estimateCost: () => 0.001,
  }
}

describe('decide()', () => {
  it('returns a reply decision when API says reply', async () => {
    const client = makeMockClient({ kind: 'reply', text: 'Continue' })
    const input: DecideInput = { goal, milestones, currentMilestoneId: 'm1', lastSnapshot: makeSnapshot('Should I continue?'), recentLogTail: [], validation: {}, learnings: [], steering: { tech: null, structure: null } }
    const out = await decide(client, input)
    expect(out.result.kind).toBe('reply')
    if (out.result.kind === 'reply') expect(out.result.text).toBe('Continue')
  })

  it('returns a reset decision when API says reset', async () => {
    const client = makeMockClient({ kind: 'reset' })
    const input: DecideInput = { goal, milestones, currentMilestoneId: 'm1', lastSnapshot: makeSnapshot('q'), recentLogTail: [], validation: {}, learnings: [], steering: { tech: null, structure: null } }
    const out = await decide(client, input)
    expect(out.result.kind).toBe('reset')
  })

  it('reports usage and cost', async () => {
    const client = makeMockClient({ kind: 'reply', text: 'ok' }, {
      inputTokens: 200, cachedInputTokens: 1500, cacheCreationTokens: 0, outputTokens: 100,
    })
    const input: DecideInput = { goal, milestones, currentMilestoneId: 'm1', lastSnapshot: makeSnapshot('q'), recentLogTail: [], validation: {}, learnings: [], steering: { tech: null, structure: null } }
    const out = await decide(client, input)
    expect(out.usage.inputTokens).toBe(200)
    expect(out.costUsd).toBeCloseTo(0.001)
  })
})
