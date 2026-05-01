import { describe, it, expect, vi } from 'vitest'
import {
  parseProDecision, decidePro, checkPrinciples, applyPrinciplesToApprove,
} from '../src/main/autopilot-pro/decision'
import type { ProDecideInput, ProSettledSnapshot, ProMarker } from '../src/main/autopilot-pro/types'
import type { ApiClient, ApiUsage } from '../src/main/autopilot/types'

const baseSnap: ProSettledSnapshot = {
  text: 'doing the thing',
  marker: { kind: 'WAITING', text: 'q', raw: '[ORCH:WAITING] q', shape: 'reply' },
  receivedAt: 0,
}

const baseInput = (shape: ProDecideInput['shape'], extras: Partial<ProDecideInput> = {}): ProDecideInput => ({
  shape,
  stage: 'discovery',
  goalSummary: 'build a small thing',
  artifacts: {},
  currentPhaseId: null,
  currentTaskId: null,
  validation: {},
  lastSnapshot: baseSnap,
  recentLogTail: [],
  ...extras,
})

describe('parseProDecision', () => {
  describe('reply', () => {
    it('parses clean reply', () => {
      expect(parseProDecision('reply', '{"shape":"reply","text":"go"}'))
        .toEqual({ shape: 'reply', text: 'go' })
    })

    it('falls back to reply with raw text on malformed JSON', () => {
      const r = parseProDecision('reply', 'not json')
      expect(r.shape).toBe('reply')
      if (r.shape === 'reply') expect(r.text).toBe('not json')
    })

    it('extracts JSON wrapped in markdown fence', () => {
      expect(parseProDecision('reply', '```json\n{"shape":"reply","text":"x"}\n```'))
        .toEqual({ shape: 'reply', text: 'x' })
    })

    it('extracts JSON with prose before', () => {
      expect(parseProDecision('reply', 'Here: {"shape":"reply","text":"x"}'))
        .toEqual({ shape: 'reply', text: 'x' })
    })
  })

  describe('choose', () => {
    it('parses clean choose', () => {
      expect(parseProDecision('choose', '{"shape":"choose","option":"B","why":"narrower"}'))
        .toEqual({ shape: 'choose', option: 'B', why: 'narrower' })
    })

    it('rejects missing option, falls back to reply', () => {
      const r = parseProDecision('choose', '{"shape":"choose","why":"x"}')
      expect(r.shape).toBe('reply')
    })

    it('coerces missing why to empty string', () => {
      expect(parseProDecision('choose', '{"shape":"choose","option":"A"}'))
        .toEqual({ shape: 'choose', option: 'A', why: '' })
    })
  })

  describe('approve', () => {
    it('parses approve verdict', () => {
      expect(parseProDecision('approve', '{"shape":"approve","verdict":"approve","why":"clean"}'))
        .toEqual({ shape: 'approve', verdict: 'approve', why: 'clean' })
    })

    it('parses refine verdict with directive', () => {
      expect(parseProDecision('approve', '{"shape":"approve","verdict":"refine","directive":"add tests"}'))
        .toEqual({ shape: 'approve', verdict: 'refine', directive: 'add tests' })
    })

    it('rejects unknown verdict, falls back to reply', () => {
      const r = parseProDecision('approve', '{"shape":"approve","verdict":"maybe"}')
      expect(r.shape).toBe('reply')
    })

    it('truncates refine directive at 500 chars', () => {
      const long = 'x'.repeat(1000)
      const r = parseProDecision('approve', `{"shape":"approve","verdict":"refine","directive":"${long}"}`)
      expect(r.shape).toBe('approve')
      if (r.shape === 'approve' && r.verdict === 'refine') {
        expect(r.directive.length).toBe(500)
      }
    })
  })

  describe('route', () => {
    it('parses route', () => {
      expect(parseProDecision('route', '{"shape":"route","skill":"brainstorming","why":"open-ended"}'))
        .toEqual({ shape: 'route', skill: 'brainstorming', why: 'open-ended' })
    })

    it('rejects empty skill, falls back to reply', () => {
      const r = parseProDecision('route', '{"shape":"route","skill":"","why":"x"}')
      expect(r.shape).toBe('reply')
    })
  })

  describe('validate', () => {
    it('parses verified', () => {
      expect(parseProDecision('validate', '{"shape":"validate","verdict":"verified"}'))
        .toEqual({ shape: 'validate', verdict: 'verified' })
    })

    it('parses research with query', () => {
      expect(parseProDecision('validate', '{"shape":"validate","verdict":"research","query":"check API X"}'))
        .toEqual({ shape: 'validate', verdict: 'research', query: 'check API X' })
    })

    it('rejects unknown verdict, falls back to reply', () => {
      const r = parseProDecision('validate', '{"shape":"validate","verdict":"maybe"}')
      expect(r.shape).toBe('reply')
    })
  })

  describe('transition', () => {
    it('parses advance', () => {
      expect(parseProDecision('transition', '{"shape":"transition","action":"advance","why":"approved"}'))
        .toEqual({ shape: 'transition', action: 'advance', why: 'approved' })
    })

    it('parses cycle', () => {
      expect(parseProDecision('transition', '{"shape":"transition","action":"cycle","why":"refine plan"}'))
        .toEqual({ shape: 'transition', action: 'cycle', why: 'refine plan' })
    })

    it('parses final-review', () => {
      expect(parseProDecision('transition', '{"shape":"transition","action":"final-review","why":"all done"}'))
        .toEqual({ shape: 'transition', action: 'final-review', why: 'all done' })
    })

    it('rejects unknown action, falls back to reply', () => {
      const r = parseProDecision('transition', '{"shape":"transition","action":"halt","why":"x"}')
      expect(r.shape).toBe('reply')
    })
  })

  describe('shape mismatch', () => {
    it('falls back to reply when expected shape != response shape', () => {
      // Asked for choose, got an approve response
      const r = parseProDecision('choose', '{"shape":"approve","verdict":"approve"}')
      expect(r.shape).toBe('reply')
    })
  })
})

describe('decide-with-rationale shape parser (Wave 1.5)', () => {
  it('parses well-formed JSON', () => {
    const result = parseProDecision('decide-with-rationale', '{"shape":"decide-with-rationale","recommendation":"Option A","why":"simpler"}')
    expect(result.shape).toBe('decide-with-rationale')
    if (result.shape === 'decide-with-rationale') {
      expect(result.recommendation).toBe('Option A')
      expect(result.why).toBe('simpler')
    }
  })

  it('falls back to reply when JSON is malformed', () => {
    const result = parseProDecision('decide-with-rationale', 'not json')
    expect(result.shape).toBe('reply')
  })

  it('falls back when recommendation field missing', () => {
    const result = parseProDecision('decide-with-rationale', '{"shape":"decide-with-rationale","why":"x"}')
    expect(result.shape).toBe('reply')
  })
})

describe('decidePro', () => {
  function fakeClient(chatResponse: string, tokens = 100): ApiClient {
    return {
      decide: vi.fn(),
      debug: vi.fn(),
      chat: vi.fn(async () => ({
        text: chatResponse,
        usage: { inputTokens: tokens, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: tokens / 2 } as ApiUsage,
      })),
      estimateCost: () => 0.001,
    }
  }

  it('calls client.chat with the per-shape system prompt and parses the response', async () => {
    const client = fakeClient('{"shape":"reply","text":"continue"}')
    const out = await decidePro(client, baseInput('reply'))
    expect(client.chat).toHaveBeenCalledTimes(1)
    expect(out.result).toEqual({ shape: 'reply', text: 'continue' })
    expect(out.costUsd).toBeGreaterThan(0)
  })

  it('throws clearly if chat method missing', async () => {
    const client: ApiClient = { decide: vi.fn(), debug: vi.fn(), estimateCost: () => 0 }
    await expect(decidePro(client, baseInput('reply'))).rejects.toThrow(/chat/i)
  })

  it('falls back to reply on shape mismatch from the planner', async () => {
    // Asked for choose, planner returned approve — should degrade safely
    const client = fakeClient('{"shape":"approve","verdict":"approve"}')
    const out = await decidePro(client, baseInput('choose'))
    expect(out.result.shape).toBe('reply')
  })
})

describe('checkPrinciples', () => {
  const m = (extras: Partial<ProMarker> = {}): ProMarker => ({
    kind: 'WAITING', text: 'x', raw: '[ORCH:WAITING] x', ...extras,
  })

  it('flags BOUNDARY (hard) when boundaryOk is false', () => {
    const v = checkPrinciples({ marker: m({ boundaryOk: false }) })
    expect(v.find((x) => x.name === 'BOUNDARY')?.severity).toBe('hard')
  })

  it('does not flag BOUNDARY when boundaryOk is true or undefined', () => {
    expect(checkPrinciples({ marker: m({ boundaryOk: true }) })).toEqual([])
    expect(checkPrinciples({ marker: m({}) })).toEqual([])
  })

  it('flags TDD (hard) when test files changed but RED_PHASE is no', () => {
    const v = checkPrinciples({
      marker: m({ filesChanged: ['src/foo.ts', 'tests/foo.test.ts'], redPhase: 'no' }),
    })
    expect(v.find((x) => x.name === 'TDD')?.severity).toBe('hard')
  })

  it('does NOT flag TDD when redPhase is yes or na', () => {
    expect(checkPrinciples({ marker: m({ filesChanged: ['tests/x.test.ts'], redPhase: 'yes' }) })).toEqual([])
    expect(checkPrinciples({ marker: m({ filesChanged: ['tests/x.test.ts'], redPhase: 'na' }) })).toEqual([])
  })

  it('does NOT flag TDD when no test files were touched', () => {
    expect(checkPrinciples({ marker: m({ filesChanged: ['src/foo.ts'], redPhase: 'no' }) })).toEqual([])
  })

  it('flags SECURITY (hard) for .env / credentials.json paths', () => {
    const v = checkPrinciples({ marker: m({ filesChanged: ['src/foo.ts', '.env'] }) })
    expect(v.find((x) => x.name === 'SECURITY')?.severity).toBe('hard')

    const v2 = checkPrinciples({ marker: m({ filesChanged: ['config/credentials.json'] }) })
    expect(v2.find((x) => x.name === 'SECURITY')?.severity).toBe('hard')
  })
})

describe('applyPrinciplesToApprove', () => {
  const baseMarker: ProMarker = { kind: 'WAITING', text: 'x', raw: '[ORCH:WAITING] x' }

  it('overrides approve→refine when a hard violation exists', () => {
    const out = applyPrinciplesToApprove(
      { shape: 'approve', verdict: 'approve' },
      { marker: { ...baseMarker, boundaryOk: false } },
    )
    expect(out.result.verdict).toBe('refine')
    expect(out.violations.length).toBeGreaterThan(0)
    expect(out.violations[0].severity).toBe('hard')
    if (out.result.verdict === 'refine') {
      expect(out.result.directive).toMatch(/BOUNDARY/)
    }
  })

  it('passes approve through when no violations', () => {
    const out = applyPrinciplesToApprove(
      { shape: 'approve', verdict: 'approve', why: 'clean' },
      { marker: baseMarker },
    )
    expect(out.result.verdict).toBe('approve')
    expect(out.violations).toEqual([])
  })

  it('does not modify a refine verdict regardless of violations', () => {
    const out = applyPrinciplesToApprove(
      { shape: 'approve', verdict: 'refine', directive: 'fix it' },
      { marker: { ...baseMarker, boundaryOk: false } },
    )
    expect(out.result.verdict).toBe('refine')
    if (out.result.verdict === 'refine') expect(out.result.directive).toBe('fix it')
  })
})
