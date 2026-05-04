import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAutopilotCouncil } from '../src/main/autopilot-council'
import { AutopilotCouncilStateMachine, type CouncilReviewer } from '../src/main/autopilot-council/state-machine'
import { saveCouncilRuntime } from '../src/main/autopilot-council/runtime-state'
import type { AutopilotCouncilOptions, CouncilGate, ProMarker, ReviewerDecision } from '../src/main/autopilot-council/types'

let dirs: string[] = []

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cmdcld-council-sm-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function reviewer(result: Awaited<ReturnType<CouncilReviewer['review']>>): CouncilReviewer {
  return {
    review: vi.fn(async () => result),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
  }
}

function sequentialReviewer(results: Array<Awaited<ReturnType<CouncilReviewer['review']>>>): CouncilReviewer {
  return {
    review: vi.fn(async () => {
      const result = results.shift()
      if (result === undefined) throw new Error('unexpected reviewer call')
      return result
    }),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
  }
}

function decision(decision: ReviewerDecision): Awaited<ReturnType<CouncilReviewer['review']>> {
  return { kind: 'decision', decision, raw: JSON.stringify(decision) }
}

function opts(overrides: Partial<AutopilotCouncilOptions> = {}): AutopilotCouncilOptions {
  return {
    terminalId: 'impl',
    reviewerTerminalId: 'review',
    projectPath: project(),
    freeTextIdea: 'Build feature',
    implementerCli: 'codex',
    reviewerCli: 'claude',
    reviewerLaunchArgs: '',
    intensity: 'balanced',
    costCapUsd: 1,
    apiProvider: 'anthropic',
    apiKey: 'key',
    plannerModel: 'model',
    writeToPty: vi.fn(),
    onPtyData: vi.fn(() => vi.fn()),
    onUpdate: vi.fn(),
    startReviewer: vi.fn(async () => {}),
    stopReviewer: vi.fn(),
    ...overrides,
  }
}

function marker(extra: Partial<ProMarker> = {}): ProMarker {
  return {
    kind: 'WAITING',
    raw: '[ORCH:WAITING]',
    text: '',
    shape: 'approve',
    artifactPath: 'spec.md',
    ...extra,
  }
}

async function runGate(args: {
  review: Awaited<ReturnType<CouncilReviewer['review']>>
  gate?: CouncilGate
  marker?: ProMarker
  terminalTail?: string
  options?: Partial<AutopilotCouncilOptions>
}) {
  const writes: string[] = []
  const root = args.options?.projectPath ?? project()
  const sm = new AutopilotCouncilStateMachine(opts({
    ...args.options,
    projectPath: root,
    writeToPty: (_id, data) => { writes.push(data) },
  }), reviewer(args.review))

  await sm.testReviewGate({
    gate: args.gate ?? 'spec',
    marker: args.marker ?? marker(),
    terminalTail: args.terminalTail ?? 'ready',
  })

  return { sm, writes, root }
}

describe('AutopilotCouncilStateMachine', () => {
  it('starts in discovery and sends Council implementer prompt/kickoff', async () => {
    const writes: string[] = []
    const startReviewer = vi.fn(async () => {})
    const r = reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    }))
    const sm = new AutopilotCouncilStateMachine(opts({
      startReviewer,
      writeToPty: (_id, data) => { writes.push(data) },
    }), r)

    await sm.start()

    expect(sm.getState().stage).toBe('discovery')
    expect(sm.getState().control).toBe('running')
    expect(startReviewer).toHaveBeenCalledOnce()
    expect(r.start).toHaveBeenCalledOnce()
    expect(writes.join('\n')).toContain('AUTOPILOT COUNCIL ROLE')
    expect(writes.join('\n')).toContain('STAGE 0')
  })

  it('approve review writes packet/decision state and continues', async () => {
    const root = project()
    writeFileSync(join(root, 'spec.md'), '# Spec')

    const { sm } = await runGate({
      options: { projectPath: root },
      review: decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'ok',
      }),
    })

    expect(sm.getState().lastCouncilDecision?.action).toBe('continue')
    expect(sm.getState().lastReviewPacketId).toBe('001-spec-review')
    expect(existsSync(join(root, '.autopilot-council', 'packets', '001-spec-review.request.md'))).toBe(true)
    expect(readFileSync(join(root, '.autopilot-council', 'decisions.md'), 'utf-8')).toContain('spec: continue')
  })

  it('refine review sends bounded instruction to implementer and records decision', async () => {
    const longInstruction = 'Fix this. '.repeat(2000)

    const { sm, writes } = await runGate({
      review: decision({
        verdict: 'refine',
        risk: 'medium',
        findings: [],
        recommended_instruction: longInstruction,
        rationale: 'needs work',
      }),
    })

    const instruction = writes.find((write) => write.includes('Council Reviewer refinement'))
    expect(sm.getState().lastCouncilDecision?.action).toBe('instruct-implementer')
    expect(instruction).toBeDefined()
    expect(instruction!.length).toBeLessThanOrEqual(2500)
    expect(instruction).toContain('Fix this.')
  })

  it('high-risk disagreement/escalation blocks for user according to arbitration policy', async () => {
    const disagreement = await runGate({
      gate: 'architecture',
      marker: marker({ shape: 'decide-with-rationale', artifactPath: undefined }),
      review: decision({
        verdict: 'disagree',
        risk: 'high',
        findings: [],
        recommended_instruction: 'Do not migrate.',
        rationale: 'Data loss risk.',
      }),
    })

    expect(disagreement.sm.getState().control).toBe('blocked')
    expect(disagreement.sm.getState().lastCouncilDecision?.action).toBe('ask-user')
    expect(disagreement.sm.getState().escalationReason).toContain('Data loss risk')

    const escalation = await runGate({
      review: decision({
        verdict: 'escalate',
        risk: 'medium',
        findings: [],
        recommended_instruction: 'Ask the user.',
        rationale: 'Scope decision.',
      }),
    })

    expect(escalation.sm.getState().control).toBe('blocked')
    expect(escalation.sm.getState().escalationReason).toContain('Scope decision')
  })

  it('timeout/invalid reviewer result is handled deterministically', async () => {
    const timeout = await runGate({ review: { kind: 'timeout', raw: '' } })
    expect(timeout.sm.getState().control).toBe('blocked')
    expect(timeout.sm.getState().reviewerStatus).toBe('timed-out')
    expect(timeout.sm.getState().lastCouncilDecision).toMatchObject({
      action: 'ask-user',
      reviewerVerdict: 'timeout',
    })

    const invalid = await runGate({
      gate: 'architecture',
      review: { kind: 'invalid', error: 'bad json', raw: 'wat' },
    })
    expect(invalid.sm.getState().control).not.toBe('blocked')
    expect(invalid.sm.getState().reviewerStatus).toBe('protocol-violation')
    expect(invalid.sm.getState().lastCouncilDecision).toMatchObject({
      action: 'ignore-reviewer',
      reviewerVerdict: 'invalid',
    })
  })

  it('invalid first reviewer response triggers exactly one retry and then uses the repaired decision', async () => {
    const r = sequentialReviewer([
      { kind: 'invalid', error: 'bad json', raw: '{nope' },
      decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'repaired',
      }),
    ])
    const root = project()
    const sm = new AutopilotCouncilStateMachine(opts({ projectPath: root }), r)

    await sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })

    expect(r.review).toHaveBeenCalledTimes(2)
    expect(vi.mocked(r.review).mock.calls[1][0]).toContain('prior Reviewer response was invalid')
    expect(vi.mocked(r.review).mock.calls[1][0]).toContain('Return valid framed JSON')
    expect(sm.getState().reviewerStatus).toBe('idle')
    expect(sm.getState().lastCouncilDecision).toMatchObject({
      action: 'continue',
      reviewerVerdict: 'approve',
    })
  })

  it('invalid twice triggers fallback according to critical and non-critical gate rules', async () => {
    const criticalReviewer = sequentialReviewer([
      { kind: 'invalid', error: 'bad json', raw: '{nope' },
      { kind: 'invalid', error: 'still bad', raw: 'no json' },
    ])
    const critical = new AutopilotCouncilStateMachine(opts(), criticalReviewer)

    await critical.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })

    expect(criticalReviewer.review).toHaveBeenCalledTimes(2)
    expect(critical.getState().control).toBe('blocked')
    expect(critical.getState().lastCouncilDecision).toMatchObject({
      action: 'ask-user',
      reviewerVerdict: 'invalid',
      reason: 'still bad',
    })

    const nonCriticalReviewer = sequentialReviewer([
      { kind: 'invalid', error: 'bad json', raw: '{nope' },
      { kind: 'invalid', error: 'still bad', raw: 'no json' },
    ])
    const nonCritical = new AutopilotCouncilStateMachine(opts(), nonCriticalReviewer)

    await nonCritical.testReviewGate({
      gate: 'architecture',
      marker: marker({ shape: 'decide-with-rationale', artifactPath: undefined }),
      terminalTail: 'ready',
    })

    expect(nonCriticalReviewer.review).toHaveBeenCalledTimes(2)
    expect(nonCritical.getState().control).not.toBe('blocked')
    expect(nonCritical.getState().lastCouncilDecision).toMatchObject({
      action: 'ignore-reviewer',
      reviewerVerdict: 'invalid',
      reason: 'still bad',
    })
  })

  it('timeout does not spin in an unbounded retry loop', async () => {
    const r = sequentialReviewer([{ kind: 'timeout', raw: '' }])
    const sm = new AutopilotCouncilStateMachine(opts(), r)

    await sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })

    expect(r.review).toHaveBeenCalledOnce()
    expect(sm.getState().reviewerStatus).toBe('timed-out')
    expect(sm.getState().lastCouncilDecision?.reviewerVerdict).toBe('timeout')
  })

  it('pause/resume/stop lifecycle is idempotent enough and does not duplicate kickoff on resume', async () => {
    const writes: string[] = []
    const detach = vi.fn()
    const stopReviewer = vi.fn()
    const sm = new AutopilotCouncilStateMachine(opts({
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: vi.fn(() => detach),
      stopReviewer,
    }), reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    })))

    await sm.start()
    sm.pause()
    sm.pause()
    sm.resume()
    sm.resume()
    sm.stop()
    sm.stop()

    expect(writes.filter((write) => write.includes('Idea: """Build feature"""'))).toHaveLength(1)
    expect(sm.getState().control).toBe('stopped')
    expect(detach).toHaveBeenCalledOnce()
    expect(stopReviewer).toHaveBeenCalledOnce()
  })

  it('runtime resume restores state/packet counters enough to continue next packet sequence', async () => {
    const root = project()
    const base = opts({ projectPath: root })
    saveCouncilRuntime(root, {
      mode: 'council',
      stage: 'planning',
      control: 'paused',
      terminalId: base.terminalId,
      reviewerTerminalId: base.reviewerTerminalId,
      implementerCli: base.implementerCli,
      reviewerCli: base.reviewerCli,
      intensity: base.intensity,
      humanApproval: {
        highRiskDisagreement: true,
        reviewerEscalation: true,
        repeatedHighRiskBlock: true,
        beforeEveryPhase: false,
        beforeCommit: false,
      },
      cycleCount: 2,
      costUsd: 0,
      costCapUsd: 1,
      validation: {},
      recentLog: [],
      liveStatus: null,
      escalationReason: null,
      lastMarker: null,
      lastCouncilDecision: null,
      lastReviewPacketId: '004-plan-review',
      reviewerStatus: 'idle',
      reviewerWarning: null,
      permissionRequest: null,
    }, {
      packetSequence: 4,
      repeatedBlockByGate: { plan: 1 },
    })

    const { sm } = await runGate({
      options: { projectPath: root },
      gate: 'plan',
      marker: marker({ artifactPath: 'plan.md' }),
      review: decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'ok',
      }),
    })

    expect(sm.getState().stage).toBe('planning')
    expect(sm.getState().lastReviewPacketId).toBe('005-plan-review')
  })

  it('public createAutopilotCouncil handle delegates methods and returns state', async () => {
    const writes: string[] = []
    const handle = createAutopilotCouncil(opts({
      writeToPty: (_id, data) => { writes.push(data) },
    }))

    await handle.start()
    handle.pause()
    expect(handle.getState().control).toBe('paused')
    handle.resume()
    handle.replyToWaiting('Proceed with defaults.')
    handle.respondToPermission('deny')
    handle.stop()

    expect(writes.join('\n')).toContain('Proceed with defaults.')
    expect(writes.join('\n')).toContain('n')
    expect(handle.getState().mode).toBe('council')
    expect(handle.getState().control).toBe('stopped')
  })
})
