import { describe, it, expect, vi } from 'vitest'
import { debugCall } from '../src/main/autopilot/debug'
import type { ApiClient, DebugInput, Goal, SettledSnapshot, ApiUsage } from '../src/main/autopilot/types'

const goal: Goal = {
  goal: 'g', nonGoals: [], acceptance: [],
  constraints: { maxIterations: 40, maxApiCostUsd: 1.0, maxDoerOutputPerReset: 60000 },
}
const snap: SettledSnapshot = {
  text: 'ctx',
  marker: { kind: 'STUCK', text: 'cannot find npm', raw: '[ORCH:STUCK] cannot find npm', blocker: 'cannot find npm' },
  receivedAt: 0,
}
const baseInput: DebugInput = {
  goal, currentMilestoneId: 'm1', lastSnapshot: snap, trigger: 'stuck',
}

function fakeClient(result: 'retry' | 'block' | 'human'): ApiClient {
  return {
    decide: vi.fn() as any,
    debug: vi.fn(async () => ({
      result: result === 'retry'
        ? { kind: 'retry', instruction: 'try `npm i`' }
        : result === 'block'
          ? { kind: 'block', reason: 'goal not testable' }
          : { kind: 'human', reason: 'tradeoff' },
      usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage,
    })),
    estimateCost: () => 0.001,
  }
}

describe('debugCall', () => {
  it('returns retry result with cost', async () => {
    const out = await debugCall(fakeClient('retry'), baseInput)
    expect(out.result.kind).toBe('retry')
    if (out.result.kind === 'retry') expect(out.result.instruction).toBe('try `npm i`')
    expect(out.costUsd).toBeGreaterThan(0)
  })

  it('returns block result', async () => {
    const out = await debugCall(fakeClient('block'), baseInput)
    expect(out.result.kind).toBe('block')
  })

  it('returns human result', async () => {
    const out = await debugCall(fakeClient('human'), baseInput)
    expect(out.result.kind).toBe('human')
  })

  it('catches client errors and returns human classification', async () => {
    const failing: ApiClient = {
      decide: vi.fn() as any,
      debug: vi.fn(async () => { throw new Error('rate limit') }),
      estimateCost: () => 0,
    }
    const out = await debugCall(failing, baseInput)
    expect(out.result.kind).toBe('human')
    if (out.result.kind === 'human') expect(out.result.reason).toMatch(/rate limit|debug call failed/i)
  })
})
