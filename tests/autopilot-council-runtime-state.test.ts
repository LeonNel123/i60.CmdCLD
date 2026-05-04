import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { councilPath } from '../src/main/autopilot-council/state-files'
import { loadCouncilRuntime, saveCouncilRuntime } from '../src/main/autopilot-council/runtime-state'
import type { CouncilState } from '../src/main/autopilot-council/types'

let dir: string | null = null

function project(): string {
  dir = mkdtempSync(join(tmpdir(), 'cmdcld-council-runtime-'))
  return dir
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

function state(): CouncilState {
  return {
    mode: 'council',
    stage: 'planning',
    control: 'running',
    terminalId: 'impl',
    reviewerTerminalId: 'review',
    implementerCli: 'claude',
    reviewerCli: 'codex',
    intensity: 'balanced',
    humanApproval: {
      highRiskDisagreement: true,
      reviewerEscalation: true,
      repeatedHighRiskBlock: true,
      beforeEveryPhase: false,
      beforeCommit: false,
    },
    cycleCount: 3,
    costUsd: 0.12,
    costCapUsd: 1,
    validation: {},
    recentLog: [],
    liveStatus: 'waiting',
    escalationReason: null,
    lastMarker: null,
    lastCouncilDecision: null,
    lastReviewPacketId: null,
    reviewerStatus: 'idle',
    reviewerWarning: null,
    permissionRequest: null,
  }
}

function writeRuntime(root: string, snapshot: unknown): void {
  mkdirSync(councilPath(root, '.'), { recursive: true })
  writeFileSync(councilPath(root, 'runtime.json'), JSON.stringify(snapshot))
}

describe('council runtime state', () => {
  it('saves and loads council runtime state', () => {
    const root = project()
    saveCouncilRuntime(root, state(), { packetSequence: 4, repeatedBlockByGate: { plan: 1 } })
    const loaded = loadCouncilRuntime(root)
    expect(loaded?.state.stage).toBe('planning')
    expect(loaded?.internals.packetSequence).toBe(4)
    expect(loaded?.internals.repeatedBlockByGate.plan).toBe(1)
  })

  it('returns null for missing runtime file', () => {
    expect(loadCouncilRuntime(project())).toBeNull()
  })

  it('returns null for corrupt runtime JSON', () => {
    const root = project()
    mkdirSync(councilPath(root, '.'), { recursive: true })
    writeFileSync(councilPath(root, 'runtime.json'), '{not json')
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for runtime state with invalid control', () => {
    const root = project()
    writeRuntime(root, {
      state: { ...state(), control: 'invalid' },
      internals: { packetSequence: 4, repeatedBlockByGate: {} },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for runtime state missing recentLog', () => {
    const root = project()
    const runtimeState = state() as Partial<CouncilState>
    delete runtimeState.recentLog
    writeRuntime(root, {
      state: runtimeState,
      internals: { packetSequence: 4, repeatedBlockByGate: {} },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for non-object repeated block counts', () => {
    const root = project()
    writeRuntime(root, {
      state: state(),
      internals: { packetSequence: 4, repeatedBlockByGate: [] },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for invalid packet sequence', () => {
    const root = project()
    writeRuntime(root, {
      state: state(),
      internals: { packetSequence: null, repeatedBlockByGate: {} },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for repeated block counters with malformed values', () => {
    const root = project()
    writeRuntime(root, {
      state: state(),
      internals: { packetSequence: 4, repeatedBlockByGate: { plan: '2', final: null, spec: {} } },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for repeated block counters with unknown gate keys', () => {
    const root = project()
    writeRuntime(root, {
      state: state(),
      internals: { packetSequence: 4, repeatedBlockByGate: { bogus: 1 } },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })

  it('returns null for negative or non-finite repeated block counters', () => {
    const root = project()
    writeRuntime(root, {
      state: state(),
      internals: { packetSequence: 4, repeatedBlockByGate: { plan: -1, final: Infinity } },
    })
    expect(loadCouncilRuntime(root)).toBeNull()
  })
})
