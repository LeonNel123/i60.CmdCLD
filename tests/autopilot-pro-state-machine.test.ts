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
