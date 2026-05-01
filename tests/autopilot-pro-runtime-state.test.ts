import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { saveRuntime, loadRuntime } from '../src/main/autopilot-pro/runtime-state'
import type { ProState } from '../src/main/autopilot-pro/types'

const TMP = join(__dirname, '.tmp-autopilot-pro-runtime')

beforeEach(() => { mkdirSync(join(TMP, '.autopilot-pro'), { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

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

describe('PRO runtime-state save/load', () => {
  it('saveRuntime + loadRuntime round-trips persisted fields', () => {
    const state = makeProState({ stage: 'implementation', currentPhaseId: 'phase-2', currentTaskId: 'T3', cycleCount: 12, costUsd: 0.34 })
    // Write a plan.md so the validation passes
    writeFileSync(join(TMP, '.autopilot-pro', 'plan.md'), '## Phase 2: middle\n- [ ] T3: do\n')
    saveRuntime(TMP, state, { markerFallbackPromptCount: 1, stage3KickoffSentForPhase: 'phase-1', stage4KickoffSent: false, metaAutoFired: false, phaseTrackerEscalated: false, outputVolumeSinceReset: 23420 })
    const loaded = loadRuntime(TMP, state.artifacts)
    expect(loaded).not.toBeNull()
    expect(loaded!.stage).toBe('implementation')
    expect(loaded!.currentPhaseId).toBe('phase-2')
    expect(loaded!.cycleCount).toBe(12)
    expect(loaded!.outputVolumeSinceReset).toBe(23420)
  })

  it('loadRuntime returns null when file absent', () => {
    expect(loadRuntime(TMP, {})).toBeNull()
  })

  it('loadRuntime drops file when stage4KickoffSent=true but final-review.md absent and reviews not all approved', () => {
    const state = makeProState({ stage: 'final-review' })
    saveRuntime(TMP, state, { markerFallbackPromptCount: 0, stage3KickoffSentForPhase: null, stage4KickoffSent: true, metaAutoFired: false, phaseTrackerEscalated: false, outputVolumeSinceReset: 0 })
    const loaded = loadRuntime(TMP, {})
    expect(loaded).toBeNull()
    const files = readdirSync(join(TMP, '.autopilot-pro'))
    const stale = files.filter((f) => f.startsWith('runtime.json.stale-'))
    expect(stale.length).toBe(1)
  })

  it('loadRuntime drops file when currentPhaseId set but plan.md does not have that phase', () => {
    const state = makeProState({ stage: 'implementation', currentPhaseId: 'phase-99' })
    saveRuntime(TMP, state, { markerFallbackPromptCount: 0, stage3KickoffSentForPhase: null, stage4KickoffSent: false, metaAutoFired: false, phaseTrackerEscalated: false, outputVolumeSinceReset: 0 })
    writeFileSync(join(TMP, '.autopilot-pro', 'plan.md'), '## Phase 1: only\n- [ ] T1: a\n')
    const loaded = loadRuntime(TMP, {})
    expect(loaded).toBeNull()
  })

  it('loadRuntime accepts when currentPhaseId is null (no plan.md required)', () => {
    const state = makeProState({ stage: 'discovery', currentPhaseId: null })
    saveRuntime(TMP, state, { markerFallbackPromptCount: 0, stage3KickoffSentForPhase: null, stage4KickoffSent: false, metaAutoFired: false, phaseTrackerEscalated: false, outputVolumeSinceReset: 0 })
    const loaded = loadRuntime(TMP, {})
    expect(loaded).not.toBeNull()
    expect(loaded!.stage).toBe('discovery')
  })
})
