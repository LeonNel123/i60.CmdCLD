import { describe, it, expect } from 'vitest'
import { runResetSequencePro } from '../src/main/autopilot-pro/reset'
import type { ProState } from '../src/main/autopilot-pro/types'

function makeProState(overrides: Partial<ProState> = {}): ProState {
  return {
    stage: 'discovery',
    currentPhaseId: null,
    currentTaskId: null,
    artifacts: {},
    cycleCount: 0,
    costUsd: 0,
    costCapUsd: 1.0,
    recentLog: [],
    escalationReason: null,
    validation: {},
    subagentRunning: false,
    subagentEtaMs: 0,
    liveStatus: null,
    lastMarker: null,
    permissionRequest: null,
    ...overrides,
  }
}

describe('runResetSequencePro', () => {
  it('writes 4 things in order: summary → /clear → system prompt → resume', async () => {
    const writes: string[] = []
    const settleResolvers: (() => void)[] = []
    const promise = runResetSequencePro({
      writeToPty: (s) => writes.push(s),
      waitForSettle: () => new Promise<void>((res) => settleResolvers.push(res)),
      state: makeProState({ stage: 'implementation', currentPhaseId: 'phase-1' }),
    })

    // Step 1 fires immediately
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('state.md')

    // Resolve first settle → step 2 fires
    settleResolvers.shift()!()
    await Promise.resolve()
    await Promise.resolve()
    expect(writes).toHaveLength(2)
    expect(writes[1]).toBe('/clear\r')

    // Resolve second settle → steps 3 + 4 fire
    settleResolvers.shift()!()
    await promise

    expect(writes).toHaveLength(4)
    expect(writes[2]).toContain('autonomous orchestrator')   // DOER_SYSTEM_PROMPT_PRO marker
    expect(writes[3]).toContain('Resume autopilot work')
  })

  it('passes the current state to buildResumePromptPro', async () => {
    const writes: string[] = []
    const settleResolvers: (() => void)[] = []
    const promise = runResetSequencePro({
      writeToPty: (s) => writes.push(s),
      waitForSettle: () => new Promise<void>((res) => settleResolvers.push(res)),
      state: makeProState({ stage: 'phase-review', currentPhaseId: 'phase-3' }),
    })
    settleResolvers.shift()!()
    await Promise.resolve()
    settleResolvers.shift()!()
    await promise
    expect(writes[3]).toContain('reviews/phase-3.md')
  })

  it('does NOT include plan.md in resume prompt for discovery stage', async () => {
    const writes: string[] = []
    const settleResolvers: (() => void)[] = []
    const promise = runResetSequencePro({
      writeToPty: (s) => writes.push(s),
      waitForSettle: () => new Promise<void>((res) => settleResolvers.push(res)),
      state: makeProState({ stage: 'discovery' }),
    })
    settleResolvers.shift()!()
    await Promise.resolve()
    settleResolvers.shift()!()
    await promise
    expect(writes[3]).not.toContain('plan.md')
  })

  it('returns after exactly 4 writes (no extra writes)', async () => {
    const writes: string[] = []
    const settleResolvers: (() => void)[] = []
    const promise = runResetSequencePro({
      writeToPty: (s) => writes.push(s),
      waitForSettle: () => new Promise<void>((res) => settleResolvers.push(res)),
      state: makeProState(),
    })
    settleResolvers.shift()!()
    await Promise.resolve()
    settleResolvers.shift()!()
    await promise
    expect(writes).toHaveLength(4)
  })
})
