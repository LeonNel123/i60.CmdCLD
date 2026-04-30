import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { AutopilotProStateMachine, enrichProMarker } from '../src/main/autopilot-pro/state-machine'
import type { AutopilotProOptions, ProDecideResult } from '../src/main/autopilot-pro/types'
import type { ApiClient, ApiUsage } from '../src/main/autopilot/types'
import { writeArtifact, markApproved } from '../src/main/autopilot-pro/artifacts'

const TMP = join(__dirname, '.tmp-autopilot-pro-sm')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

function fakeChatClient(plan: () => ProDecideResult): ApiClient {
  // For PRO, decidePro calls client.chat() and parses the JSON response.
  // We return a JSON string matching the planned ProDecideResult.
  return {
    decide: vi.fn(),
    debug: vi.fn(),
    chat: vi.fn(async () => ({
      text: JSON.stringify(plan()),
      usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage,
    })),
    estimateCost: () => 0.001,
  }
}

function makeSm(api: ApiClient, writes?: string[]): AutopilotProStateMachine {
  const opts: AutopilotProOptions = {
    terminalId: 't',
    projectPath: TMP,
    freeTextIdea: 'a small thing',
    costCapUsd: 1.0,
    apiProvider: 'anthropic',
    apiKey: 'fake',
    plannerModel: 'claude-sonnet-4-6',
    writeToPty: (_id, data) => { writes?.push(data) },
    onPtyData: () => () => {},
    onUpdate: () => {},
  }
  return new AutopilotProStateMachine(opts, api, 10, 24 * 60 * 60 * 1000)
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50))
}

describe('AutopilotProStateMachine', () => {
  describe('initial stage detection', () => {
    it('starts in discovery when no spec.md exists', () => {
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
      expect(sm.state.stage).toBe('discovery')
    })

    it('starts in planning when spec.md exists and is approved', () => {
      writeArtifact(TMP, 'spec', '# spec body')
      markApproved(TMP, 'spec')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
      expect(sm.state.stage).toBe('planning')
    })

    it('starts in implementation when both spec + plan approved', () => {
      writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
      writeArtifact(TMP, 'plan', '# plan'); markApproved(TMP, 'plan')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
      expect(sm.state.stage).toBe('implementation')
    })

    it('reverts to discovery when spec.md sha256 has drifted since approval', () => {
      writeArtifact(TMP, 'spec', '# v1')
      markApproved(TMP, 'spec')
      // External edit
      writeArtifact(TMP, 'spec', '# v2 tampered')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
      expect(sm.state.stage).toBe('discovery')  // reconcile auto-unapproved
    })
  })

  describe('reply shape dispatch', () => {
    it('writes the reply text to PTY', async () => {
      const writes: string[] = []
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'continue working' })), writes)
      await sm.start()
      writes.length = 0  // discard kickoff
      sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
      await flush()
      expect(writes.some((w) => w.includes('continue working'))).toBe(true)
    })
  })

  describe('choose shape dispatch', () => {
    it('writes the chosen option + rationale to PTY', async () => {
      const writes: string[] = []
      const sm = makeSm(fakeChatClient(() => ({ shape: 'choose', option: 'B', why: 'narrower scope' })), writes)
      await sm.start()
      writes.length = 0
      sm.feedPty([
        '[ORCH:WAITING] which?',
        'DECISION_SHAPE: choose',
        'OPTIONS:',
        '  - A: do it all',
        '  - B: just the core',
        '',
      ].join('\n'))
      await flush()
      expect(writes.some((w) => w.includes('Pick: B') && w.includes('narrower scope'))).toBe(true)
    })
  })

  describe('approve shape — approve verdict advances stages', () => {
    it('approving spec.md advances discovery → planning', async () => {
      writeArtifact(TMP, 'spec', '# spec body')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'looks good' })))
      await sm.start()
      expect(sm.state.stage).toBe('discovery')
      sm.feedPty([
        '[ORCH:WAITING] review please',
        'DECISION_SHAPE: approve',
        'ARTIFACT: spec.md',
        '',
      ].join('\n'))
      await flush()
      expect(sm.state.stage).toBe('planning')
      expect(sm.state.artifacts['spec.md']?.approved).toBe(true)
    })
  })

  describe('approve shape — refine increments counter', () => {
    it('writes refine directive and increments refineCount', async () => {
      writeArtifact(TMP, 'spec', '# spec body')
      const writes: string[] = []
      const sm = makeSm(
        fakeChatClient(() => ({ shape: 'approve', verdict: 'refine', directive: 'add non-goals' })),
        writes,
      )
      await sm.start()
      writes.length = 0
      sm.feedPty([
        '[ORCH:WAITING] review please',
        'DECISION_SHAPE: approve',
        'ARTIFACT: spec.md',
        '',
      ].join('\n'))
      await flush()
      expect(writes.some((w) => w.includes('Refine spec.md') && w.includes('add non-goals'))).toBe(true)
      expect(sm.state.artifacts['spec.md']?.refineCount).toBe(1)
    })

    it('escalates after refinement bound (3) is exceeded', async () => {
      writeArtifact(TMP, 'spec', '# spec')
      const writes: string[] = []
      const sm = makeSm(
        fakeChatClient(() => ({ shape: 'approve', verdict: 'refine', directive: 'try again' })),
        writes,
      )
      await sm.start()
      // 4 refines: 1, 2, 3 succeed; 4th escalates
      for (let i = 0; i < 4; i++) {
        sm.feedPty([
          '[ORCH:WAITING] review',
          'DECISION_SHAPE: approve',
          'ARTIFACT: spec.md',
          '',
        ].join('\n'))
        await flush()
      }
      expect(sm.state.escalationReason).toMatch(/refinement-bound-exceeded/)
    })
  })

  describe('principles enforcement (BOUNDARY hard)', () => {
    it('overrides approve→refine when BOUNDARY_OK: no', async () => {
      writeArtifact(TMP, 'spec', '# spec')
      const writes: string[] = []
      // Planner says approve, but doer reported boundary violation — orchestrator overrides.
      const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'lgtm' })), writes)
      await sm.start()
      writes.length = 0
      sm.feedPty([
        '[ORCH:WAITING] review',
        'DECISION_SHAPE: approve',
        'ARTIFACT: spec.md',
        'BOUNDARY_OK: no',
        '',
      ].join('\n'))
      await flush()
      // Should refine, NOT approve. Spec stays unapproved.
      expect(sm.state.artifacts['spec.md']?.approved).toBeFalsy()
      expect(writes.some((w) => w.includes('Refine'))).toBe(true)
    })
  })

  describe('subagent ETA window', () => {
    it('extends silence guard when SUBAGENT_ETA_MIN is reported', async () => {
      vi.useFakeTimers()
      writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
      writeArtifact(TMP, 'plan', '# plan'); markApproved(TMP, 'plan')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
      await sm.start()
      sm.feedPty([
        '[ORCH:WAITING] dispatching',
        'STATUS: subagent-running',
        'SUBAGENT_ETA_MIN: 5',
        '',
      ].join('\n'))
      await vi.advanceTimersByTimeAsync(20)
      // After this marker, subagentRunning should be true and ETA non-zero.
      expect(sm.state.subagentRunning).toBe(true)
      expect(sm.state.subagentEtaMs).toBe(5 * 60_000)
      vi.useRealTimers()
    })
  })

  describe('transcript', () => {
    it('writes a transcript block per orchestrator action', async () => {
      writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
      writeArtifact(TMP, 'plan', '# plan'); markApproved(TMP, 'plan')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'go' })))
      await sm.start()
      sm.feedPty('[ORCH:WAITING] question?\nDECISION_SHAPE: reply\n')
      await flush()
      const path = join(TMP, '.autopilot-pro', 'transcript.md')
      expect(existsSync(path)).toBe(true)
      const transcript = readFileSync(path, 'utf-8')
      expect(transcript).toContain('shape=reply')
      expect(transcript).toContain('go')
    })
  })

  describe('replyToWaiting', () => {
    it('records a user-manual transcript block', () => {
      writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
      writeArtifact(TMP, 'plan', '# p'); markApproved(TMP, 'plan')
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'unused' })))
      sm.replyToWaiting('use port 8080')
      const transcript = readFileSync(join(TMP, '.autopilot-pro', 'transcript.md'), 'utf-8')
      expect(transcript).toContain('user-manual')
      expect(transcript).toContain('use port 8080')
    })
  })
})

describe('phase tracker integration (Wave 3.1 G1)', () => {
  function setupImplStage() {
    writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: setup
- [x] T1: install deps
- [ ] T2: configure
## Phase 2: ship
- [ ] T1: cut release
`); markApproved(TMP, 'plan')
  }

  it('sets currentPhaseId to phase-1 when first phase has unfinished tasks', async () => {
    setupImplStage()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.currentPhaseId).toBe('phase-1')
  })

  it('sets currentTaskId to first non-done task in current phase', async () => {
    setupImplStage()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.currentTaskId).toBe('T2')
  })

  it('enters phase-review for phase-1 when phase-1 tasks all done (no review yet)', async () => {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: a
- [x] T1: a
## Phase 2: b
- [ ] T1: b
`); markApproved(TMP, 'plan')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('phase-review')
    expect(sm.state.currentPhaseId).toBe('phase-1')
  })

  it('escalates exactly once when plan has no parseable phases', async () => {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', '# Plan\n\nFree-form text. No phase headers.\n'); markApproved(TMP, 'plan')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.escalationReason).toMatch(/no parseable phases/i)
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    const escalations = sm.state.recentLog.filter((e) => e.kind === 'escalation' && /parseable phases/.test(e.summary))
    expect(escalations.length).toBe(1)
  })

  it('does not run the phase tracker when stage is "discovery"', async () => {
    // Even a settled cycle must not set currentPhaseId — the guard
    // `if (state.stage !== 'implementation') return` blocks the tracker.
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('discovery')
    expect(sm.state.currentPhaseId).toBeNull()
    expect(sm.state.currentTaskId).toBeNull()
  })

  it('enters phase-review for phase-1 when all phases tasks are done but no reviews exist', async () => {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: a
- [x] T1: a
## Phase 2: b
- [x] T1: b
`); markApproved(TMP, 'plan')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('phase-review')
    expect(sm.state.currentPhaseId).toBe('phase-1')
  })
})

describe('Stage 3 phase-review pipeline (Wave 3.1 G3)', () => {
  function setupAllPhase1Done() {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: setup
- [x] T1: install
- [x] T2: configure
## Phase 2: ship
- [ ] T1: cut release
`); markApproved(TMP, 'plan')
  }

  it('enters phase-review stage when phase-1 tasks all done', async () => {
    setupAllPhase1Done()
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })), writes)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('phase-review')
    expect(sm.state.currentPhaseId).toBe('phase-1')
  })

  it('writes Stage 3 kickoff to PTY exactly once per phase', async () => {
    setupAllPhase1Done()
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })), writes)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q1\nDECISION_SHAPE: reply\n')
    await flush()
    sm.feedPty('[ORCH:WAITING] q2\nDECISION_SHAPE: reply\n')
    await flush()
    const kickoffs = writes.filter((w) => w.includes('STAGE 3') && w.includes('phase-1'))
    expect(kickoffs.length).toBe(1)
  })

  it('approving reviews/phase-1.md returns to implementation and advances tracker', async () => {
    setupAllPhase1Done()
    writeArtifact(TMP, 'review', '# review body', 'phase-1')
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'lgtm' })), writes)
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] please review',
      'DECISION_SHAPE: approve',
      'ARTIFACT: reviews/phase-1.md',
      '',
    ].join('\n'))
    await flush()
    expect(sm.state.artifacts['reviews/phase-1.md']?.approved).toBe(true)
    sm.feedPty('[ORCH:WAITING] cont\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('implementation')
    expect(sm.state.currentPhaseId).toBe('phase-2')
  })

  it('after last phase review approved, advances to final-review', async () => {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: only
- [x] T1: done
`); markApproved(TMP, 'plan')
    writeArtifact(TMP, 'review', '# r', 'phase-1'); markApproved(TMP, 'review', 'phase-1')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('final-review')
  })

  it('refine on review increments refineCount', async () => {
    setupAllPhase1Done()
    writeArtifact(TMP, 'review', '# review body', 'phase-1')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'refine', directive: 'sharpen' })))
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] please review',
      'DECISION_SHAPE: approve',
      'ARTIFACT: reviews/phase-1.md',
      '',
    ].join('\n'))
    await flush()
    expect(sm.state.artifacts['reviews/phase-1.md']?.refineCount).toBe(1)
  })

  it('escalates after refine bound (3) on a review', async () => {
    setupAllPhase1Done()
    writeArtifact(TMP, 'review', '# r', 'phase-1')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'refine', directive: 'try again' })))
    await sm.start()
    for (let i = 0; i < 4; i++) {
      sm.feedPty([
        '[ORCH:WAITING] r',
        'DECISION_SHAPE: approve',
        'ARTIFACT: reviews/phase-1.md',
        '',
      ].join('\n'))
      await flush()
    }
    expect(sm.state.escalationReason).toMatch(/refinement-bound-exceeded/)
  })

  it('does not re-fire Stage 3 kickoff after the review is approved', async () => {
    setupAllPhase1Done()
    writeArtifact(TMP, 'review', '# r', 'phase-1'); markApproved(TMP, 'review', 'phase-1')
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })), writes)
    await sm.start()
    writes.length = 0
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    const phase1Kickoffs = writes.filter((w) => w.includes('STAGE 3') && w.includes('phase-1'))
    expect(phase1Kickoffs.length).toBe(0)
    expect(sm.state.stage).toBe('implementation')
    expect(sm.state.currentPhaseId).toBe('phase-2')
  })
})

describe('Stage 4 final-review + auto-meta (Wave 3.1 G4 + G5)', () => {
  function setupAllReviewsApproved() {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: only
- [x] T1: done
`); markApproved(TMP, 'plan')
    writeArtifact(TMP, 'review', '# r', 'phase-1'); markApproved(TMP, 'review', 'phase-1')
  }

  it('writes Stage 4 kickoff once when entering final-review', async () => {
    setupAllReviewsApproved()
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })), writes)
    await sm.start()
    writes.length = 0
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('final-review')
    const stage4Writes = writes.filter((w) => w.includes('STAGE 4'))
    expect(stage4Writes.length).toBe(1)
  })

  it('does not re-fire Stage 4 kickoff on subsequent cycles', async () => {
    setupAllReviewsApproved()
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })), writes)
    await sm.start()
    writes.length = 0  // clear start-time noise (DOER prompt, etc.)
    sm.feedPty('[ORCH:WAITING] q1\nDECISION_SHAPE: reply\n')
    await flush()
    sm.feedPty('[ORCH:WAITING] q2\nDECISION_SHAPE: reply\n')
    await flush()
    const stage4Writes = writes.filter((w) => w.includes('STAGE 4'))
    expect(stage4Writes.length).toBe(1)
  })

  it('transition action=final-review while stage=final-review sets stage=done', async () => {
    setupAllReviewsApproved()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'transition', action: 'final-review', why: 'all reviews in' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.stage).toBe('final-review')
    sm.feedPty([
      '[ORCH:WAITING] final review complete',
      'DECISION_SHAPE: transition',
      '',
    ].join('\n'))
    await flush()
    await new Promise((r) => setTimeout(r, 100))
    expect(sm.state.stage).toBe('done')
  })

  it('auto-fires meta when stage transitions to done', async () => {
    setupAllReviewsApproved()
    const chatCalls: Array<{ system: string; user: string }> = []
    const client: ApiClient = {
      decide: vi.fn(),
      debug: vi.fn(),
      chat: vi.fn(async (args: any) => {
        chatCalls.push({ system: args.system, user: args.user })
        if (args.system.includes('Meta-Orchestrator')) {
          return {
            text: '{"classification":"done","summary":"all done"}',
            usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage,
          }
        }
        return {
          text: JSON.stringify({ shape: 'transition', action: 'final-review', why: 'go' }),
          usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage,
        }
      }),
      estimateCost: () => 0.001,
    }
    const sm = makeSm(client)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: transition\n')
    await flush()
    await new Promise((r) => setTimeout(r, 150))
    expect(sm.state.stage).toBe('done')
    expect(existsSync(join(TMP, '.autopilot-pro', 'final-summary.md'))).toBe(true)
    const metaCalled = chatCalls.some((c) => c.system.includes('Meta-Orchestrator'))
    expect(metaCalled).toBe(true)
  })

  it('records meta-auto transcript block on auto-fire', async () => {
    setupAllReviewsApproved()
    const client: ApiClient = {
      decide: vi.fn(), debug: vi.fn(),
      chat: vi.fn(async (args: any) => {
        if (args.system.includes('Meta-Orchestrator')) {
          return { text: '{"classification":"done","summary":"clean run"}',
            usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage }
        }
        return { text: JSON.stringify({ shape: 'transition', action: 'final-review', why: 'go' }),
          usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage }
      }),
      estimateCost: () => 0.001,
    }
    const sm = makeSm(client)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: transition\n')
    await flush()
    await new Promise((r) => setTimeout(r, 150))
    const transcript = readFileSync(join(TMP, '.autopilot-pro', 'transcript.md'), 'utf-8')
    expect(transcript).toContain('meta-auto')
    expect(transcript).toContain('classification=done')
  })

  it('meta auto-fires only once even with repeated transitions', async () => {
    setupAllReviewsApproved()
    let metaCalls = 0
    const client: ApiClient = {
      decide: vi.fn(), debug: vi.fn(),
      chat: vi.fn(async (args: any) => {
        if (args.system.includes('Meta-Orchestrator')) {
          metaCalls++
          return { text: '{"classification":"done","summary":"x"}',
            usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage }
        }
        return { text: JSON.stringify({ shape: 'transition', action: 'final-review', why: 'go' }),
          usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage }
      }),
      estimateCost: () => 0.001,
    }
    const sm = makeSm(client)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: transition\n')
    await flush()
    await new Promise((r) => setTimeout(r, 150))
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: transition\n')
    await flush()
    await new Promise((r) => setTimeout(r, 150))
    expect(metaCalls).toBe(1)
  })

  it('meta auto-fire failure surfaces final-summary.md fallback (stage stays done)', async () => {
    setupAllReviewsApproved()
    const client: ApiClient = {
      decide: vi.fn(), debug: vi.fn(),
      chat: vi.fn(async (args: any) => {
        if (args.system.includes('Meta-Orchestrator')) {
          throw new Error('rate limited')
        }
        return { text: JSON.stringify({ shape: 'transition', action: 'final-review', why: 'go' }),
          usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage }
      }),
      estimateCost: () => 0.001,
    }
    const sm = makeSm(client)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: transition\n')
    await flush()
    await new Promise((r) => setTimeout(r, 150))
    expect(sm.state.stage).toBe('done')
    // runMetaReflect catches API errors and writes a done-fallback final-summary.md
    expect(existsSync(join(TMP, '.autopilot-pro', 'final-summary.md'))).toBe(true)
  })
})

describe('enrichProMarker', () => {
  it('parses DECISION_SHAPE / ARTIFACT / OPTIONS / ASSUMPTION / DELTA / SUBAGENT_ETA_MIN', () => {
    const text = [
      'preamble',
      '[ORCH:WAITING] q',
      'DECISION_SHAPE: choose',
      'ARTIFACT: spec.md',
      'OPTIONS:',
      '  - A: do it',
      '  - B: skip it',
      'ASSUMPTION: lib X does Y',
      'DELTA:',
      '  add endpoint POST /v1/cancel',
      'SUBAGENT_ETA_MIN: 7',
    ].join('\n')
    const m = enrichProMarker(text, { kind: 'WAITING', text: 'q', raw: '[ORCH:WAITING] q' })
    expect(m.shape).toBe('choose')
    expect(m.artifactPath).toBe('spec.md')
    expect(m.options).toEqual(['A: do it', 'B: skip it'])
    expect(m.assumption).toBe('lib X does Y')
    expect(m.delta).toContain('POST /v1/cancel')
    expect(m.subagentEtaMin).toBe(7)
  })

  it('leaves shape undefined when DECISION_SHAPE is absent (back-compat)', () => {
    const text = '[ORCH:WAITING] just a question'
    const m = enrichProMarker(text, { kind: 'WAITING', text: 'just a question', raw: '[ORCH:WAITING] just a question' })
    expect(m.shape).toBeUndefined()
  })
})
