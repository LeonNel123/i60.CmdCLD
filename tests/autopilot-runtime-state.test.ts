import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { saveRuntimeClassic, loadRuntimeClassic } from '../src/main/autopilot/runtime-state'
import type { AutopilotState, Milestone } from '../src/main/autopilot/types'

const TMP = join(__dirname, '.tmp-autopilot-runtime')

beforeEach(() => { mkdirSync(join(TMP, '.autopilot'), { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

function makeState(overrides: Partial<AutopilotState> = {}): AutopilotState {
  return {
    phase: 'idle',
    goal: null,
    milestones: [],
    currentMilestoneId: null,
    cycleCount: 0,
    costUsd: 0,
    costCapUsd: 1.0,
    lastDecisionText: '',
    recentLog: [],
    escalationReason: null,
    validation: {},
    liveStatus: null,
    lastMarker: null,
    permissionRequest: null,
    ...overrides,
  }
}

describe('Classic runtime-state save/load', () => {
  it('saveRuntimeClassic + loadRuntimeClassic round-trips', () => {
    const state = makeState({ phase: 'executing', currentMilestoneId: 'm2', cycleCount: 7, costUsd: 0.12 })
    const milestones: Milestone[] = [{ id: 'm2', name: 'second', status: 'in-progress', subgoals: [], notes: '' }]
    saveRuntimeClassic(TMP, state, { markerFallbackPromptCount: 0, partialStreak: 0, outputVolumeSinceReset: 1234 })
    const loaded = loadRuntimeClassic(TMP, milestones)
    expect(loaded).not.toBeNull()
    expect(loaded!.phase).toBe('executing')
    expect(loaded!.currentMilestoneId).toBe('m2')
    expect(loaded!.cycleCount).toBe(7)
    expect(loaded!.outputVolumeSinceReset).toBe(1234)
  })

  it('loadRuntimeClassic returns null when file absent', () => {
    expect(loadRuntimeClassic(TMP, [])).toBeNull()
  })

  it('loadRuntimeClassic drops file when currentMilestoneId set but milestones array does not include it', () => {
    const state = makeState({ phase: 'executing', currentMilestoneId: 'm99' })
    saveRuntimeClassic(TMP, state, { markerFallbackPromptCount: 0, partialStreak: 0, outputVolumeSinceReset: 0 })
    const loaded = loadRuntimeClassic(TMP, [{ id: 'm1', name: 'first', status: 'pending', subgoals: [], notes: '' }])
    expect(loaded).toBeNull()
    const files = readdirSync(join(TMP, '.autopilot'))
    const stale = files.filter((f) => f.startsWith('runtime.json.stale-'))
    expect(stale.length).toBe(1)
  })
})
