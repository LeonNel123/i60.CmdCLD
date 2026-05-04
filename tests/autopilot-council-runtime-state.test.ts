import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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

function expectInvalidInternalsNotSaved(root: string, internals: unknown): void {
  expect(() => saveCouncilRuntime(root, state(), internals as never)).toThrow(/Invalid council runtime internals/)
  expect(existsSync(councilPath(root, 'runtime.json'))).toBe(false)
}

function expectInvalidStateNotSaved(root: string, runtimeState: unknown): void {
  expect(() => saveCouncilRuntime(root, runtimeState as never, { packetSequence: 4, repeatedBlockByGate: {} })).toThrow(
    /Invalid council runtime state/,
  )
  expect(existsSync(councilPath(root, 'runtime.json'))).toBe(false)
}

function expectRuntimeStateRejected(root: string, runtimeState: unknown): void {
  writeRuntime(root, {
    state: runtimeState,
    internals: { packetSequence: 4, repeatedBlockByGate: {} },
  })
  expect(loadCouncilRuntime(root)).toBeNull()
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

  it('saves and loads plain object runtime maps', () => {
    const root = project()
    saveCouncilRuntime(
      root,
      { ...state(), validation: { test: 'npm test', typecheck: 'npx tsc --noEmit' } },
      { packetSequence: 4, repeatedBlockByGate: { plan: 1, final: 0 } },
    )
    const loaded = loadCouncilRuntime(root)
    expect(loaded?.state.validation.test).toBe('npm test')
    expect(loaded?.internals.repeatedBlockByGate.final).toBe(0)
  })

  it('saves and loads council runtime state without a reviewer terminal', () => {
    const root = project()
    saveCouncilRuntime(root, { ...state(), reviewerTerminalId: null }, { packetSequence: 4, repeatedBlockByGate: {} })
    expect(loadCouncilRuntime(root)?.state.reviewerTerminalId).toBeNull()
  })

  it('throws without writing for invalid runtime state', () => {
    const root = project()
    expectInvalidStateNotSaved(root, { ...state(), stage: 'invalid' })
  })

  it('throws without writing for non-plain runtime state objects', () => {
    const root = project()
    expectInvalidStateNotSaved(root, { ...state(), validation: new Date(0) })
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
    expectRuntimeStateRejected(root, runtimeState)
  })

  it.each([
    'humanApproval',
    'validation',
    'liveStatus',
    'lastCouncilDecision',
    'permissionRequest',
  ] satisfies Array<keyof CouncilState>)('returns null for runtime state missing required field %s', (field) => {
    const root = project()
    const runtimeState = state() as Partial<CouncilState>
    delete runtimeState[field]
    expectRuntimeStateRejected(root, runtimeState)
  })

  it('returns null for runtime state with invalid stage', () => {
    const root = project()
    expectRuntimeStateRejected(root, { ...state(), stage: 'invalid' })
  })

  it('returns null for runtime state with invalid CLI values', () => {
    const root = project()
    expectRuntimeStateRejected(root, { ...state(), implementerCli: 'bad-cli' })
  })

  it('returns null for runtime state with malformed nested fields', () => {
    const root = project()
    expectRuntimeStateRejected(root, {
      ...state(),
      humanApproval: { highRiskDisagreement: true },
      validation: { test: 4 },
      lastCouncilDecision: { action: 'continue', gate: 'bogus' },
      permissionRequest: { text: 'Approve?', detectedAt: 'now' },
    })
  })

  it.each([-1, 1.5])('returns null for invalid cycle count %s', (cycleCount) => {
    const root = project()
    expectRuntimeStateRejected(root, { ...state(), cycleCount })
  })

  it.each([
    ['costUsd', -0.01],
    ['costCapUsd', -1],
  ] satisfies Array<[keyof CouncilState, number]>)('returns null for negative runtime cost %s', (field, value) => {
    const root = project()
    expectRuntimeStateRejected(root, { ...state(), [field]: value })
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

  it.each([Number.NaN, -1, 1.5])('throws without writing for invalid packet sequence %s', (packetSequence) => {
    const root = project()
    expectInvalidInternalsNotSaved(root, { packetSequence, repeatedBlockByGate: {} })
  })

  it('throws without writing for unknown repeated block gate keys', () => {
    const root = project()
    expectInvalidInternalsNotSaved(root, { packetSequence: 4, repeatedBlockByGate: { bogus: 1 } })
  })

  it('throws without writing for non-plain repeated block counters', () => {
    const root = project()
    expectInvalidInternalsNotSaved(root, { packetSequence: 4, repeatedBlockByGate: new Date(0) })
  })

  it.each([Number.POSITIVE_INFINITY, -1])('throws without writing for invalid repeated block counter %s', (plan) => {
    const root = project()
    expectInvalidInternalsNotSaved(root, { packetSequence: 4, repeatedBlockByGate: { plan } })
  })
})
