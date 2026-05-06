import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AutopilotProStateMachine, enrichProMarker } from '../src/main/autopilot-pro/state-machine'
import type { AutopilotProOptions, ProDecideResult } from '../src/main/autopilot-pro/types'
import type { ApiClient, ApiUsage } from '../src/main/autopilot/types'
import { writeArtifact, markApproved, readState } from '../src/main/autopilot-pro/artifacts'
import { formatPtyWrite } from '../src/main/autopilot/pty-write'

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

function makeSm(api?: ApiClient, writes?: string[], overrides: Partial<AutopilotProOptions> = {}): AutopilotProStateMachine {
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
    runtimeJson: false,
    budgetTracker: false,
    researchEnabled: false,
    ...overrides,
  }
  const apiClient = api ?? fakeChatClient(() => ({ shape: 'reply', text: 'x' }))
  return new AutopilotProStateMachine(opts, apiClient, 10, 24 * 60 * 60 * 1000)
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

    it('skips the planner for direct greenlight prompts', async () => {
      const writes: string[] = []
      const api = fakeChatClient(() => ({ shape: 'reply', text: '' }))
      const sm = makeSm(api, writes)
      await sm.start()
      writes.length = 0
      sm.feedPty('[ORCH:WAITING] m2 complete - greenlight m3/s1?\nDECISION_SHAPE: reply\n')
      await flush()
      expect(writes).toContain('Yes, proceed with m3/s1.\r')
      expect(api.chat).not.toHaveBeenCalled()
    })

    it('does not send blank Enter when the planner returns an empty reply', async () => {
      const writes: string[] = []
      const api = fakeChatClient(() => ({ shape: 'reply', text: '' }))
      const sm = makeSm(api, writes)
      await sm.start()
      writes.length = 0
      sm.feedPty('[ORCH:WAITING] What next?\nDECISION_SHAPE: reply\n')
      await flush()
      expect(writes).toContain('Proceed with the safest next step implied by this question: What next?\r')
      expect(api.chat).toHaveBeenCalledTimes(1)
    })

    it('writes Pro debug events for marker, planner skip, and doer write', async () => {
      const writes: string[] = []
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: '' })), writes)
      await sm.start()
      writes.length = 0
      sm.feedPty('[ORCH:WAITING] m2 complete - greenlight m3/s1?\nDECISION_SHAPE: reply\n')
      await flush()
      const debugPath = join(TMP, '.autopilot-pro', 'debug', 'events.jsonl')
      expect(existsSync(debugPath)).toBe(true)
      const events = readFileSync(debugPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line))
      expect(events.some((e) => e.kind === 'doer-settled')).toBe(true)
      expect(events.some((e) => e.kind === 'planner-skipped' && e.reason === 'direct-greenlight')).toBe(true)
      expect(events.some((e) => e.kind === 'doer-write' && e.reason === 'direct-greenlight')).toBe(true)
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

describe('stop() resets Wave 3.1 lifecycle flags', () => {
  it('stop() clears stage4KickoffSent so a subsequent start() re-fires the kickoff', async () => {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: only
- [x] T1: done
`); markApproved(TMP, 'plan')
    writeArtifact(TMP, 'review', '# r', 'phase-1'); markApproved(TMP, 'review', 'phase-1')
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'ok' })), writes)
    await sm.start()
    writes.length = 0  // discard kickoff noise (DOER prompt, impl stage kickoff)
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    const firstFireCount = writes.filter((w) => w.includes('STAGE 4')).length
    expect(firstFireCount).toBe(1)
    sm.stop()
    writes.length = 0
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    // stage is 'final-review' on restart; kickoffForStage re-fires the Stage 4 message.
    // Filter with startsWith to avoid matching 'STAGE 4' inside the DOER_SYSTEM_PROMPT_PRO.
    const secondFireCount = writes.filter((w) => w.startsWith('STAGE 4')).length
    expect(secondFireCount).toBe(1)
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

  it('parses approve details from carriage-return structured blocks', () => {
    const text = [
      '[ORCH:WAITING]\r',
      'STATUS: waiting\r',
      'DECISION_SHAPE: approve\r',
      'ARTIFACT: .autopilot-pro/spec.md\r',
      'QUESTION: Approve .autopilot-pro/spec.md to proceed to Stage 1 planning?\r',
    ].join('')
    const m = enrichProMarker(text, { kind: 'WAITING', text: '', raw: '[ORCH:WAITING]' })
    expect(m.shape).toBe('approve')
    expect(m.artifactPath).toBe('.autopilot-pro/spec.md')
  })

  it('parses approve details when terminal prompt prefixes the marker line', () => {
    const text = [
      '> [ORCH:WAITING]\r',
      'STATUS: waiting\r',
      'DECISION_SHAPE: approve\r',
      'ARTIFACT: .autopilot-pro/spec.md\r',
    ].join('')
    const m = enrichProMarker(text, { kind: 'WAITING', text: '', raw: '> [ORCH:WAITING]' })
    expect(m.shape).toBe('approve')
    expect(m.artifactPath).toBe('.autopilot-pro/spec.md')
  })

  it('parses Claude-compressed PRO fields on the marker line and continuation line', () => {
    const text = [
      '●[ORCH:WAITING] STATUS:waiting\r',
      '  DECISION_SHAPE: approve  ARTIFACT: .autopilot-pro/spec.md\r',
    ].join('')
    const m = enrichProMarker(text, { kind: 'WAITING', text: '', raw: '●[ORCH:WAITING] STATUS:waiting' })
    expect(m.shape).toBe('approve')
    expect(m.artifactPath).toBe('.autopilot-pro/spec.md')
  })
})

describe('enrichProMarker — research (Wave 1.6)', () => {
  it('parses RESEARCH_TOPICS block', () => {
    const text = [
      '[ORCH:WAITING] q',
      'DECISION_SHAPE: research',
      'RESEARCH_TOPICS:',
      '  - slug: backup-encryption',
      '    query: What schemes apply?',
      '    sources: https://example.com/a, https://example.com/b',
      '  - slug: rclone-presets',
      '    query: Common config?',
      '    force: true',
    ].join('\n')
    const m = enrichProMarker(text, { kind: 'WAITING', text: 'q', raw: '[ORCH:WAITING] q' })
    expect(m.researchTopics).not.toBeUndefined()
    expect(m.researchTopics!.length).toBe(2)
    expect(m.researchTopics![0].slug).toBe('backup-encryption')
    expect(m.researchTopics![0].sources).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(m.researchTopics![1].force).toBe(true)
  })

  it('parses RESEARCH_TOPIC scalar field', () => {
    const text = [
      '[ORCH:WAITING] q',
      'DECISION_SHAPE: approve',
      'RESEARCH_TOPIC: backup-encryption',
    ].join('\n')
    const m = enrichProMarker(text, { kind: 'WAITING', text: 'q', raw: '[ORCH:WAITING] q' })
    expect(m.researchTopic).toBe('backup-encryption')
  })
})

describe('spec-update DELTA application (Wave 3.1 G2 logic)', () => {
  function setupSpecUpdateContext() {
    writeArtifact(TMP, 'spec', '# original spec\n\n## Goal\nbuild a thing\n')
    markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: setup
- [ ] T1: install
`)
    markApproved(TMP, 'plan')
  }

  it('applies the delta to spec.md when planner approves', async () => {
    setupSpecUpdateContext()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'reasonable' })))
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] need to add cancel endpoint',
      'STATUS: spec-update-request',
      'DECISION_SHAPE: approve',
      'DELTA:',
      '  add POST /v1/cancel for terminating runs',
      '',
    ].join('\n'))
    await flush()
    const spec = readFileSync(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')
    expect(spec).toContain('# original spec')
    expect(spec).toMatch(/## Updates \(/)
    expect(spec).toContain('POST /v1/cancel')
  })

  it('appends to spec-changelog.md', async () => {
    setupSpecUpdateContext()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'ok' })))
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] update needed',
      'STATUS: spec-update-request',
      'DECISION_SHAPE: approve',
      'DELTA:',
      '  add timeout config',
      '',
    ].join('\n'))
    await flush()
    expect(existsSync(join(TMP, '.autopilot-pro', 'spec-changelog.md'))).toBe(true)
    const log = readFileSync(join(TMP, '.autopilot-pro', 'spec-changelog.md'), 'utf-8')
    expect(log).toContain('add timeout config')
  })

  it('keeps spec.md approved after applying a delta', async () => {
    setupSpecUpdateContext()
    expect(readState(TMP)['spec.md']?.approved).toBe(true)
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'ok' })))
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] update',
      'STATUS: spec-update-request',
      'DECISION_SHAPE: approve',
      'DELTA:',
      '  add x',
      '',
    ].join('\n'))
    await flush()
    expect(sm.state.artifacts['spec.md']?.approved).toBe(true)
  })

  it('does NOT apply the delta when planner refines', async () => {
    setupSpecUpdateContext()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'refine', directive: 'too vague' })))
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] update',
      'STATUS: spec-update-request',
      'DECISION_SHAPE: approve',
      'DELTA:',
      '  vague delta',
      '',
    ].join('\n'))
    await flush()
    const spec = readFileSync(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')
    expect(spec).not.toMatch(/## Updates \(/)
    expect(existsSync(join(TMP, '.autopilot-pro', 'spec-changelog.md'))).toBe(false)
  })

  it('multiple sequential deltas append independently', async () => {
    setupSpecUpdateContext()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'ok' })))
    await sm.start()
    sm.feedPty([
      '[ORCH:WAITING] u1',
      'STATUS: spec-update-request',
      'DECISION_SHAPE: approve',
      'DELTA:',
      '  delta one',
      '',
    ].join('\n'))
    await flush()
    sm.feedPty([
      '[ORCH:WAITING] u2',
      'STATUS: spec-update-request',
      'DECISION_SHAPE: approve',
      'DELTA:',
      '  delta two',
      '',
    ].join('\n'))
    await flush()
    const spec = readFileSync(join(TMP, '.autopilot-pro', 'spec.md'), 'utf-8')
    expect((spec.match(/## Updates \(/g) ?? []).length).toBe(2)
    expect(spec).toContain('delta one')
    expect(spec).toContain('delta two')
  })
})

describe('IPC writeToPty wraps multiline writes in bracketed-paste (Wave 3.2)', () => {
  it('the kickoff routed through formatPtyWrite is wrapped in BP markers', async () => {
    const writes: string[] = []
    const opts: AutopilotProOptions = {
      terminalId: 't',
      projectPath: TMP,
      freeTextIdea: 'a small thing',
      costCapUsd: 1.0,
      apiProvider: 'anthropic',
      apiKey: 'fake',
      plannerModel: 'claude-sonnet-4-6',
      // Mirror the production IPC handler exactly
      writeToPty: (_id, data) => { writes.push(formatPtyWrite(data)) },
      onPtyData: () => () => {},
      onUpdate: () => {},
    }
    const sm = new AutopilotProStateMachine(opts, fakeChatClient(() => ({ shape: 'reply', text: 'x' })), 10, 24 * 60 * 60 * 1000)
    await sm.start()

    // The DOER system prompt (multiline) must be wrapped.
    const doerPromptWrite = writes.find((w) => w.includes('DOER') || w.includes('autonomous orchestrator'))
    expect(doerPromptWrite).toBeDefined()
    expect(doerPromptWrite!.startsWith('\x1b[200~')).toBe(true)
    expect(doerPromptWrite!.endsWith('\x1b[201~\r')).toBe(true)

    // The Stage 0 kickoff (multiline) must also be wrapped.
    const kickoffWrite = writes.find((w) => w.includes('STAGE 0') || w.includes('DISCOVERY'))
    expect(kickoffWrite).toBeDefined()
    expect(kickoffWrite!.startsWith('\x1b[200~')).toBe(true)
  })

  it('a single-line reply is NOT wrapped', async () => {
    writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', '# plan'); markApproved(TMP, 'plan')
    const writes: string[] = []
    const opts: AutopilotProOptions = {
      terminalId: 't',
      projectPath: TMP,
      freeTextIdea: 'x',
      costCapUsd: 1.0,
      apiProvider: 'anthropic',
      apiKey: 'fake',
      plannerModel: 'claude-sonnet-4-6',
      writeToPty: (_id, data) => { writes.push(formatPtyWrite(data)) },
      onPtyData: () => () => {},
      onUpdate: () => {},
    }
    const sm = new AutopilotProStateMachine(opts, fakeChatClient(() => ({ shape: 'reply', text: 'continue' })), 10, 24 * 60 * 60 * 1000)
    await sm.start()
    writes.length = 0  // discard kickoff noise
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()
    const replyWrite = writes.find((w) => w.includes('continue'))
    expect(replyWrite).toBeDefined()
    // Single-line reply: no BP wrap, just the text + \r.
    expect(replyWrite!.includes('\x1b[200~')).toBe(false)
    expect(replyWrite!.includes('\x1b[201~')).toBe(false)
  })
})

describe('PRO permissionRequest (Wave 3.6)', () => {
  it('initial ProState has permissionRequest as null', () => {
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
    expect(sm.state.permissionRequest).toBeNull()
  })
})

describe('PRO app-owned hard guardrails', () => {
  it.each(['claude', 'codex'] as const)('responds to %s carriage-return approval markers', async (agentCli) => {
    writeArtifact(TMP, 'spec', '# discovery spec')
    const writes: string[] = []
    const client = fakeChatClient(() => ({ shape: 'approve', verdict: 'approve', why: 'spec is sufficient' }))
    const sm = makeSm(client, writes, { agentCli })
    await sm.start()
    writes.length = 0

    sm.feedPty([
      '[ORCH:WAITING]\r',
      'STATUS: waiting\r',
      'DECISION_SHAPE: approve\r',
      'ARTIFACT: .autopilot-pro/spec.md\r',
      'FILES_CHANGED:\r',
      '\r',
      '- .autopilot-pro/spec.md\r',
      'QUESTION: Approve .autopilot-pro/spec.md to proceed to Stage 1 planning?\r',
    ].join(''))
    await flush()

    expect(client.chat).toHaveBeenCalledTimes(1)
    expect(writes.some((w) => w.includes('Approved: .autopilot-pro/spec.md'))).toBe(true)
  })

  it('pause gates settled output until resume', async () => {
    const writes: string[] = []
    const client = fakeChatClient(() => ({ shape: 'reply', text: 'continue after resume' }))
    const sm = makeSm(client, writes)
    await sm.start()
    writes.length = 0

    sm.pause()
    sm.feedPty('[ORCH:WAITING] paused?\nDECISION_SHAPE: reply\n')
    await flush()
    expect(client.chat).not.toHaveBeenCalled()
    expect(writes).toEqual([])

    sm.resume()
    sm.feedPty('[ORCH:WAITING] resumed?\nDECISION_SHAPE: reply\n')
    await flush()
    expect(client.chat).toHaveBeenCalledTimes(1)
    expect(writes.some((w) => w.includes('continue after resume'))).toBe(true)
  })

  it('hard-blocks automation when planner spend crosses the cost cap', async () => {
    const writes: string[] = []
    let calls = 0
    const client: ApiClient = {
      decide: vi.fn(),
      debug: vi.fn(),
      chat: vi.fn(async () => {
        calls++
        return {
          text: JSON.stringify({ shape: 'reply', text: `reply ${calls}` }),
          usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage,
        }
      }),
      estimateCost: () => 1.0,
    }
    const sm = makeSm(client, writes, { costCapUsd: 0.5 })
    await sm.start()
    writes.length = 0

    sm.feedPty('[ORCH:WAITING] first\nDECISION_SHAPE: reply\n')
    await flush()
    expect(calls).toBe(1)
    expect(sm.state.escalationReason).toMatch(/cost cap/i)
    expect(sm.state.liveStatus).toMatch(/cost cap/i)
    expect(sm.state.recentLog.at(-1)?.kind).toBe('cost-threshold')
    expect(writes).toEqual([])

    sm.feedPty('[ORCH:WAITING] second\nDECISION_SHAPE: reply\n')
    await flush()
    expect(calls).toBe(1)
  })

  it('logs silence hard blocks as escalations', async () => {
    vi.useFakeTimers()
    try {
      const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })), undefined, {
        maxDoerOutputPerReset: 1000,
      })

      await sm.start()
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)

      expect(sm.state.control).toBe('blocked')
      expect(sm.state.escalationReason).toMatch(/silent/i)
      expect(sm.state.recentLog.at(-1)?.kind).toBe('escalation')
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs unsupported Codex permission prompts as escalations without replying to PTY', async () => {
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })), writes, {
      agentCli: 'codex',
    })
    sm.state.permissionRequest = { text: 'Allow command?', detectedAt: Date.now() }

    sm.respondToPermission('allow')

    expect(sm.state.control).toBe('blocked')
    expect(sm.state.escalationReason).toMatch(/Codex CLI permission prompts/i)
    expect(sm.state.recentLog.at(-1)?.kind).toBe('escalation')
    expect(writes).toEqual([])
  })
})

describe('ProState liveStatus + lastMarker (Wave 3.4)', () => {
  it('initial ProState has liveStatus and lastMarker as null', () => {
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
    expect(sm.state.liveStatus).toBeNull()
    expect(sm.state.lastMarker).toBeNull()
  })

  it('lastMarker is populated after a settle', async () => {
    writeArtifact(TMP, 'spec', '# s'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', `## Phase 1: only\n- [ ] T1: a\n`); markApproved(TMP, 'plan')
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q?\nDECISION_SHAPE: reply\n')
    await flush()
    expect(sm.state.lastMarker).not.toBeNull()
    expect(sm.state.lastMarker!.kind).toBe('WAITING')
  })
})

describe('PRO context-reset path (Wave 4.0)', () => {
  function setupExecuting() {
    writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
    writeArtifact(TMP, 'plan', '## Phase 1: only\n- [ ] T1: a\n'); markApproved(TMP, 'plan')
  }

  it('outputVolumeSinceReset increments on PTY data', async () => {
    setupExecuting()
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
    await sm.start()
    sm.feedPty('hello world')
    expect((sm as any).outputVolumeSinceReset).toBeGreaterThanOrEqual(11)
  })

  it('threshold triggers reset (small threshold for fast test)', async () => {
    setupExecuting()
    const writes: string[] = []
    const opts: AutopilotProOptions = {
      terminalId: 't',
      projectPath: TMP,
      freeTextIdea: 'x',
      costCapUsd: 1.0,
      apiProvider: 'anthropic',
      apiKey: 'fake',
      plannerModel: 'claude-sonnet-4-6',
      maxDoerOutputPerReset: 50,
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: () => () => {},
      onUpdate: () => {},
    }
    const sm = new AutopilotProStateMachine(opts, fakeChatClient(() => ({ shape: 'reply', text: 'x' })), 10, 24 * 60 * 60 * 1000)
    await sm.start()
    sm.feedPty('x'.repeat(60) + '\n')   // exceeds 50-char threshold
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')   // settle
    await flush()
    // Reset writes the summarise prompt which mentions state.md
    expect(writes.some((w) => w.includes('state.md'))).toBe(true)
  })

  it('threshold does not reset during planning artifact work', async () => {
    writeArtifact(TMP, 'spec', '# spec'); markApproved(TMP, 'spec')
    const writes: string[] = []
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'continue planning' })), writes, {
      maxDoerOutputPerReset: 50,
    })
    await sm.start()
    writes.length = 0

    sm.feedPty('x'.repeat(60) + '\n')
    sm.feedPty('[ORCH:WAITING] q\nDECISION_SHAPE: reply\n')
    await flush()

    expect(sm.state.stage).toBe('planning')
    expect(writes.some((w) => w.includes('state.md'))).toBe(false)
    expect(writes.some((w) => w.includes('continue planning'))).toBe(true)
  })

  it('outputVolumeSinceReset is at 0 immediately after construction', () => {
    const sm = makeSm(fakeChatClient(() => ({ shape: 'reply', text: 'x' })))
    expect((sm as any).outputVolumeSinceReset).toBe(0)
  })
})

describe('dispatch — research shape (Wave 1.6)', () => {
  it('approves topics, sets researchInFlight pendingTopics list, writes PTY summary', async () => {
    const writes: string[] = []
    const sm = makeSm(
      fakeChatClient(() => ({ shape: 'reply', text: 'unused' })),
      writes,
      { researchEnabled: true },
    )
    await sm.start()
    writes.length = 0  // discard kickoff noise
    // Simulate the planner returning a research result with mixed outcomes
    await sm.testHandleResult({
      shape: 'research',
      topics: [
        { slug: 'a', approve: true, budgetUsd: 0.5, reuse: null },
        { slug: 'b', approve: true, reuse: 'docs/research/b.md', budgetUsd: 0.3 },
        { slug: 'c', approve: false, reason: 'off scope' },
      ],
    })
    expect(sm.state.researchInFlight?.pendingTopics).toEqual(['a'])
    expect(sm.state.researchInFlight?.topicBudgets).toEqual({ a: 0.5 })
    expect(writes.some((w) => w.includes('a:'))).toBe(true)
    expect(writes.some((w) => w.includes('b:'))).toBe(true)
    expect(writes.some((w) => w.includes('c:'))).toBe(true)
  })

  it('clears researchInFlight when all pendingTopics are written and approved', async () => {
    const sm = makeSm(
      fakeChatClient(() => ({ shape: 'reply', text: 'unused' })),
      undefined,
      { researchEnabled: true },
    )
    await sm.start()
    await sm.testHandleResult({
      shape: 'research',
      topics: [{ slug: 'foo', approve: true, budgetUsd: 0.5, reuse: null }],
    })
    expect(sm.state.researchInFlight?.pendingTopics).toEqual(['foo'])
    // Simulate doer writing the artifact
    sm.testRecordResearchWrite('foo')
    expect(sm.state.researchInFlight).toBeUndefined()
  })
})

describe('Stage -1 auto-trigger (Wave 1.6)', () => {
  it('enters research stage when idea has URLs', async () => {
    const writes: string[] = []
    const sm = makeSm(undefined, undefined, {
      researchEnabled: true,
      freeTextIdea: 'compare https://example.com/a vs https://example.com/b',
      writeToPty: (_id: string, text: string) => { writes.push(text) },
    })
    sm.start()
    expect(sm.getState().stage).toBe('research')
    expect(writes.some((w) => w.includes('Research signals'))).toBe(true)
    expect(writes.some((w) => w.includes('compare'))).toBe(true)
  })

  it('does not enter research stage when researchEnabled=false', async () => {
    const sm = makeSm(undefined, undefined, {
      researchEnabled: false,
      freeTextIdea: 'compare https://example.com/a vs https://example.com/b',
      writeToPty: () => {},
    })
    sm.start()
    expect(sm.getState().stage).toBe('discovery')
  })
})

describe('research runtime persistence + overrun (Wave 1.6)', () => {
  it('round-trips researchInFlight + researchHistory through runtime.json', async () => {
    const TMP_RT = mkdtempSync(join(tmpdir(), 'pro-run-'))
    try {
      // First state machine: dispatches research and writes runtime
      const sm1 = makeSm(undefined, undefined, {
        researchEnabled: true,
        runtimeJson: true,
        projectPath: TMP_RT,
        writeToPty: () => {},
      })
      sm1.start()
      await sm1.testHandleResult({
        shape: 'research',
        topics: [{ slug: 'a', approve: true, budgetUsd: 0.5, reuse: null }],
      })

      // Second state machine: starts fresh, should restore state
      const sm2 = makeSm(undefined, undefined, {
        researchEnabled: true,
        runtimeJson: true,
        projectPath: TMP_RT,
        writeToPty: () => {},
      })
      sm2.start()
      expect(sm2.getState().researchInFlight?.pendingTopics).toEqual(['a'])
    } finally {
      rmSync(TMP_RT, { recursive: true, force: true })
    }
  })

  it('drops topic from pendingTopics when spend exceeds budget * 1.5', () => {
    const writes: string[] = []
    const sm = makeSm(undefined, undefined, {
      researchEnabled: true,
      writeToPty: (_id: string, t: string) => { writes.push(t) },
    })
    sm.start()
    sm.testForceResearchInFlight({
      triggerStage: 'discovery',
      pendingTopics: ['hot'],
      spendByTopic: { hot: 0 },
      topicBudgets: { hot: 0.50 },
    })
    sm.testRecordResearchSpend('hot', 0.80)  // 0.80 >= 0.50 * 1.5 = 0.75 → overrun
    expect(sm.getState().researchInFlight?.pendingTopics).toEqual([])
    expect(writes.some((w) => w.includes('exceeded budget'))).toBe(true)
  })
})
