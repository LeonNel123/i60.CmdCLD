import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

  it('does not attach PTY or send kickoff if stopped while reviewer startup is pending', async () => {
    const startup = deferred<void>()
    const writes: string[] = []
    const onPtyData = vi.fn(() => vi.fn())
    const sm = new AutopilotCouncilStateMachine(opts({
      startReviewer: vi.fn(async () => startup.promise),
      onPtyData,
      writeToPty: (_id, data) => { writes.push(data) },
    }), reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    })))

    const starting = sm.start()
    sm.stop()
    startup.resolve()
    await starting

    expect(sm.getState().control).toBe('stopped')
    expect(onPtyData).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it('cleans up reviewer process if stop happens before reviewer startup resolves', async () => {
    const startup = deferred<void>()
    const writes: string[] = []
    const onPtyData = vi.fn(() => vi.fn())
    const stopReviewer = vi.fn()
    const sm = new AutopilotCouncilStateMachine(opts({
      startReviewer: vi.fn(async () => startup.promise),
      stopReviewer,
      onPtyData,
      writeToPty: (_id, data) => { writes.push(data) },
    }), reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    })))

    const starting = sm.start()
    sm.stop()
    startup.resolve()
    await starting

    expect(sm.getState().control).toBe('stopped')
    expect(stopReviewer).toHaveBeenCalledTimes(2)
    expect(onPtyData).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
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

  it('does not write packet files or implementer instructions if stopped while review is pending', async () => {
    const pending = deferred<Awaited<ReturnType<CouncilReviewer['review']>>>()
    const writes: string[] = []
    const root = project()
    const r: CouncilReviewer = {
      review: vi.fn(async () => pending.promise),
      start: vi.fn(async () => {}),
      stop: vi.fn(),
    }
    const sm = new AutopilotCouncilStateMachine(opts({
      projectPath: root,
      writeToPty: (_id, data) => { writes.push(data) },
    }), r)
    await sm.start()
    writes.length = 0

    const reviewing = sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })
    sm.stop()
    pending.resolve(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'late',
    }))
    await reviewing

    expect(sm.getState().control).toBe('stopped')
    expect(sm.getState().lastCouncilDecision).toBeNull()
    expect(writes).toHaveLength(0)
    expect(existsSync(join(root, '.autopilot-council', 'packets', '001-spec-review.request.md'))).toBe(false)
  })

  it('does not write packet files or implementer instructions if paused while review is pending', async () => {
    const pending = deferred<Awaited<ReturnType<CouncilReviewer['review']>>>()
    const writes: string[] = []
    const root = project()
    const r: CouncilReviewer = {
      review: vi.fn(async () => pending.promise),
      start: vi.fn(async () => {}),
      stop: vi.fn(),
    }
    const sm = new AutopilotCouncilStateMachine(opts({
      projectPath: root,
      writeToPty: (_id, data) => { writes.push(data) },
    }), r)
    await sm.start()
    writes.length = 0

    const reviewing = sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })
    sm.pause()
    pending.resolve(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'late',
    }))
    await reviewing

    expect(sm.getState().control).toBe('paused')
    expect(sm.getState().lastCouncilDecision).toBeNull()
    expect(writes).toHaveLength(0)
    expect(existsSync(join(root, '.autopilot-council', 'packets', '001-spec-review.request.md'))).toBe(false)
  })

  it('pause before watcher settles prevents review and implementer writes', async () => {
    vi.useFakeTimers()
    try {
      let listener: ((data: string) => void) | null = null
      const writes: string[] = []
      const r = reviewer(decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'ok',
      }))
      const sm = new AutopilotCouncilStateMachine(opts({
        onPtyData: (_id, next) => {
          listener = next
          return vi.fn()
        },
        writeToPty: (_id, data) => { writes.push(data) },
      }), r)
      await sm.start()
      writes.length = 0

      listener?.('[ORCH:WAITING]\nSTATUS: waiting\nDECISION_SHAPE: approve\nARTIFACT: spec.md\n')
      sm.pause()
      vi.advanceTimersByTime(1500)
      await Promise.resolve()

      expect(sm.getState().control).toBe('paused')
      expect(r.review).not.toHaveBeenCalled()
      expect(writes).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pause during review cancels reviewer so resume can review next gate cleanly', async () => {
    const pending = deferred<Awaited<ReturnType<CouncilReviewer['review']>>>()
    const r: CouncilReviewer = {
      review: vi.fn()
        .mockImplementationOnce(async () => pending.promise)
        .mockImplementationOnce(async () => decision({
          verdict: 'approve',
          risk: 'low',
          findings: [],
          recommended_instruction: '',
          rationale: 'next gate ok',
        })),
      start: vi.fn(async () => {}),
      stop: vi.fn(),
    }
    const sm = new AutopilotCouncilStateMachine(opts(), r)
    await sm.start()

    const firstReview = sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'first',
    })
    sm.pause()
    pending.resolve(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'stale',
    }))
    await firstReview

    expect(r.stop).toHaveBeenCalled()
    expect(sm.getState().lastCouncilDecision).toBeNull()

    sm.resume()
    await sm.testReviewGate({
      gate: 'plan',
      marker: marker({ artifactPath: 'plan.md' }),
      terminalTail: 'second',
    })

    expect(r.start).toHaveBeenCalledTimes(2)
    expect(r.review).toHaveBeenCalledTimes(2)
    expect(sm.getState().lastReviewPacketId).toBe('001-plan-review')
    expect(sm.getState().lastCouncilDecision?.action).toBe('continue')
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

  it('empty refine instruction causes one reviewer retry and no direct reviewer-terminal write', async () => {
    const writes: Array<{ terminalId: string; data: string }> = []
    const r = sequentialReviewer([
      decision({
        verdict: 'refine',
        risk: 'medium',
        findings: [],
        recommended_instruction: '',
        rationale: 'too vague',
      }),
      decision({
        verdict: 'refine',
        risk: 'medium',
        findings: [],
        recommended_instruction: 'Name the exact file to update.',
        rationale: 'now concrete',
      }),
    ])
    const sm = new AutopilotCouncilStateMachine(opts({
      writeToPty: (terminalId, data) => { writes.push({ terminalId, data }) },
    }), r)

    await sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })

    expect(r.review).toHaveBeenCalledTimes(2)
    expect(vi.mocked(r.review).mock.calls[1][0]).toContain('prior Reviewer decision requested refine but did not include a concrete instruction')
    expect(writes.some((write) => write.terminalId === 'review')).toBe(false)
    expect(writes.some((write) => write.terminalId === 'impl' && write.data.includes('Name the exact file'))).toBe(true)
    expect(sm.getState().lastCouncilDecision?.action).toBe('instruct-implementer')
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

  it('reviewer transport exception during gate falls back deterministically', async () => {
    const r: CouncilReviewer = {
      review: vi.fn(async () => {
        throw new Error('transport down')
      }),
      start: vi.fn(async () => {}),
      stop: vi.fn(),
    }
    const sm = new AutopilotCouncilStateMachine(opts(), r)

    await sm.testReviewGate({
      gate: 'spec',
      marker: marker(),
      terminalTail: 'ready',
    })

    expect(r.review).toHaveBeenCalledTimes(2)
    expect(sm.getState().reviewerStatus).toBe('protocol-violation')
    expect(sm.getState().reviewerWarning).toBe('transport down')
    expect(sm.getState().control).toBe('blocked')
    expect(sm.getState().lastCouncilDecision).toMatchObject({
      action: 'ask-user',
      reviewerVerdict: 'invalid',
      reason: 'transport down',
    })
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

  it('concurrent start only starts reviewer once and sends one kickoff', async () => {
    const startup = deferred<void>()
    const writes: string[] = []
    const startReviewer = vi.fn(async () => startup.promise)
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

    const first = sm.start()
    const second = sm.start()
    startup.resolve()
    await Promise.all([first, second])

    expect(startReviewer).toHaveBeenCalledOnce()
    expect(r.start).toHaveBeenCalledOnce()
    expect(writes.filter((write) => write.includes('Idea: """Build feature"""'))).toHaveLength(1)
  })

  it('startup failure updates failed blocked state and rethrows', async () => {
    const error = new Error('reviewer failed to launch')
    const onUpdate = vi.fn()
    const sm = new AutopilotCouncilStateMachine(opts({
      onUpdate,
      startReviewer: vi.fn(async () => {
        throw error
      }),
    }), reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    })))

    await expect(sm.start()).rejects.toThrow('reviewer failed to launch')

    expect(sm.getState()).toMatchObject({
      control: 'blocked',
      reviewerStatus: 'failed',
      reviewerWarning: 'reviewer failed to launch',
      escalationReason: 'Reviewer startup failed: reviewer failed to launch',
    })
    expect(onUpdate).toHaveBeenCalled()
  })

  it('partial startup failure cleans up reviewer session and launched reviewer process', async () => {
    const error = new Error('reviewer session prompt failed')
    const stopReviewer = vi.fn()
    const r: CouncilReviewer = {
      review: vi.fn(async () => decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'ok',
      })),
      start: vi.fn(async () => {
        throw error
      }),
      stop: vi.fn(),
    }
    const sm = new AutopilotCouncilStateMachine(opts({
      startReviewer: vi.fn(async () => {}),
      stopReviewer,
    }), r)

    await expect(sm.start()).rejects.toThrow('reviewer session prompt failed')

    expect(r.stop).toHaveBeenCalledOnce()
    expect(stopReviewer).toHaveBeenCalledOnce()
    expect(sm.getState()).toMatchObject({
      control: 'blocked',
      reviewerStatus: 'failed',
      reviewerWarning: 'reviewer session prompt failed',
    })
  })

  it('resume from blocked uses full reviewer startup path before running', async () => {
    const firstError = new Error('initial launch failed')
    const startReviewer = vi.fn()
      .mockImplementationOnce(async () => {
        throw firstError
      })
      .mockImplementationOnce(async () => {})
    const r = reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    }))
    const sm = new AutopilotCouncilStateMachine(opts({ startReviewer }), r)

    await expect(sm.start()).rejects.toThrow('initial launch failed')
    await sm.resume()

    expect(startReviewer).toHaveBeenCalledTimes(2)
    expect(r.start).toHaveBeenCalledOnce()
    expect(sm.getState()).toMatchObject({
      control: 'running',
      reviewerStatus: 'idle',
      reviewerWarning: null,
      escalationReason: null,
    })
  })

  it('resume from blocked stays failed when reviewer restart fails', async () => {
    const startReviewer = vi.fn()
      .mockImplementationOnce(async () => {
        throw new Error('initial launch failed')
      })
      .mockImplementationOnce(async () => {
        throw new Error('restart failed')
      })
    const r = reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    }))
    const sm = new AutopilotCouncilStateMachine(opts({ startReviewer }), r)

    await expect(sm.start()).rejects.toThrow('initial launch failed')
    await expect(sm.resume()).rejects.toThrow('restart failed')

    expect(startReviewer).toHaveBeenCalledTimes(2)
    expect(sm.getState()).toMatchObject({
      control: 'blocked',
      reviewerStatus: 'failed',
      reviewerWarning: 'restart failed',
      escalationReason: 'Reviewer startup failed: restart failed',
    })
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

  it('restored running state without prior kickoff does not suppress kickoff', async () => {
    const root = project()
    const base = opts({ projectPath: root })
    saveCouncilRuntime(root, {
      mode: 'council',
      stage: 'discovery',
      control: 'running',
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
      cycleCount: 0,
      costUsd: 0,
      costCapUsd: 1,
      validation: {},
      recentLog: [],
      liveStatus: null,
      escalationReason: null,
      lastMarker: null,
      lastCouncilDecision: null,
      lastReviewPacketId: null,
      reviewerStatus: 'starting',
      reviewerWarning: null,
      permissionRequest: null,
    }, {
      packetSequence: 0,
      repeatedBlockByGate: {},
    })
    const writes: string[] = []
    const sm = new AutopilotCouncilStateMachine(opts({
      projectPath: root,
      writeToPty: (_id, data) => { writes.push(data) },
    }), reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    })))

    await sm.start()

    expect(writes.join('\n')).toContain('AUTOPILOT COUNCIL ROLE')
    expect(writes.join('\n')).toContain('Idea: """Build feature"""')
  })

  it('does not include artifact content outside the project in review packets', async () => {
    const root = project()
    const outside = join(dirname(root), 'outside.txt')
    writeFileSync(outside, 'SECRET OUTSIDE CONTENT')
    const r = reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    }))
    const sm = new AutopilotCouncilStateMachine(opts({ projectPath: root }), r)

    await sm.testReviewGate({
      gate: 'spec',
      marker: marker({ artifactPath: '../outside.txt' }),
      terminalTail: 'ready',
    })

    expect(vi.mocked(r.review).mock.calls[0][0]).not.toContain('SECRET OUTSIDE CONTENT')
  })

  it('getState and onUpdate provide defensive copies', async () => {
    const onUpdate = vi.fn((state) => {
      state.control = 'blocked'
      state.lastCouncilDecision = {
        action: 'ask-user',
        gate: 'spec',
        risk: 'high',
        instruction: 'mutated',
        reason: 'mutated',
        reviewerVerdict: 'escalate',
      }
    })
    const sm = new AutopilotCouncilStateMachine(opts({ onUpdate }), reviewer(decision({
      verdict: 'approve',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: 'ok',
    })))

    await sm.start()
    const external = sm.getState()
    external.control = 'blocked'
    external.lastCouncilDecision = {
      action: 'ask-user',
      gate: 'spec',
      risk: 'high',
      instruction: 'mutated',
      reason: 'mutated',
      reviewerVerdict: 'escalate',
    }

    expect(sm.getState().control).toBe('running')
    expect(sm.getState().lastCouncilDecision).toBeNull()
  })

  it('responds to a real detected permission request and clears it', async () => {
    vi.useFakeTimers()
    try {
      let listener: ((data: string) => void) | null = null
      const writes: string[] = []
      const sm = new AutopilotCouncilStateMachine(opts({
        onPtyData: (_id, next) => {
          listener = next
          return vi.fn()
        },
        writeToPty: (_id, data) => { writes.push(data) },
      }), reviewer(decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'ok',
      })))
      await sm.start()

      listener?.('Permission to run shell command?\n1. Yes\n2. No')
      vi.advanceTimersByTime(1500)

      expect(sm.getState().permissionRequest?.text).toContain('Permission to run')
      expect(sm.getState().control).toBe('blocked')

      sm.respondToPermission('deny')

      expect(writes.at(-1)).toBe('n\r')
      expect(sm.getState().permissionRequest).toBeNull()
      expect(sm.getState().control).toBe('running')
    } finally {
      vi.useRealTimers()
    }
  })

  it('public createAutopilotCouncil handle delegates methods and returns state', async () => {
    const writes: string[] = []
    const handle = createAutopilotCouncil(opts({
      writeToPty: (_id, data) => { writes.push(data) },
    }))

    await handle.start()
    handle.pause()
    expect(handle.getState().control).toBe('paused')
    await handle.resume()
    handle.replyToWaiting('Proceed with defaults.')
    handle.stop()

    expect(writes.join('\n')).toContain('Proceed with defaults.')
    expect(handle.getState().mode).toBe('council')
    expect(handle.getState().control).toBe('stopped')
  })

  it('public handle resume returns an awaitable promise after blocked start', async () => {
    const startReviewer = vi.fn()
      .mockImplementationOnce(async () => {
        throw new Error('launch failed')
      })
      .mockImplementationOnce(async () => {})
    const handle = createAutopilotCouncil(opts({ startReviewer }))

    await expect(handle.start()).rejects.toThrow('launch failed')
    const resumed = handle.resume()

    expect(resumed).toBeInstanceOf(Promise)
    await resumed
    expect(startReviewer).toHaveBeenCalledTimes(2)
    expect(handle.getState().control).toBe('running')
    expect(handle.getState().reviewerStatus).toBe('idle')
  })

  describe('file-based control channel', () => {
    it('uses .autopilot-council/outbox/marker.json as the primary control channel', async () => {
      const root = project()
      const writes: string[] = []
      const sm = new AutopilotCouncilStateMachine(opts({
        projectPath: root,
        writeToPty: (_id, data) => { writes.push(data) },
      }), reviewer(decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'ok',
      })))
      await sm.start()
      writes.length = 0  // discard kickoff

      mkdirSync(join(root, '.autopilot-council', 'outbox'), { recursive: true })
      writeFileSync(join(root, '.autopilot-council', 'outbox', 'marker.json'), JSON.stringify({
        schemaVersion: 1,
        id: 'council-waiting-1',
        kind: 'WAITING',
        text: 'review please',
        question: 'review please',
        shape: 'reply',
      }))

      await new Promise((r) => setTimeout(r, 1200))

      expect(writes.length).toBeGreaterThan(0)
      const inboxPath = join(root, '.autopilot-council', 'inbox', 'reply.txt')
      expect(existsSync(inboxPath)).toBe(true)
      expect(readFileSync(inboxPath, 'utf-8').length).toBeGreaterThan(0)
    })

    it('rejects invalid Council marker.json without writing to PTY', async () => {
      const root = project()
      const writes: string[] = []
      const sm = new AutopilotCouncilStateMachine(opts({
        projectPath: root,
        writeToPty: (_id, data) => { writes.push(data) },
      }), reviewer(decision({
        verdict: 'approve',
        risk: 'low',
        findings: [],
        recommended_instruction: '',
        rationale: 'should-not-be-called',
      })))
      await sm.start()
      writes.length = 0

      mkdirSync(join(root, '.autopilot-council', 'outbox'), { recursive: true })
      writeFileSync(join(root, '.autopilot-council', 'outbox', 'marker.json'), JSON.stringify({
        schemaVersion: 1,
        id: 'bad',
        kind: 'WAITING',
        shape: 'wat',
      }))

      await new Promise((r) => setTimeout(r, 1200))

      expect(writes).toEqual([])
      expect(sm.getState().recentLog.some((entry) => entry.summary.includes('control marker invalid'))).toBe(true)
    })
  })
})
