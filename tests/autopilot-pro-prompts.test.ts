import { describe, it, expect } from 'vitest'
import {
  DOER_SYSTEM_PROMPT_PRO, PRINCIPLES_BLOCK,
  buildPlannerPrompt, META_REFLECT_SYSTEM_PROMPT, buildMetaReflectPrompt,
} from '../src/main/autopilot-pro/prompts'
import type { ProDecideInput, ProSettledSnapshot } from '../src/main/autopilot-pro/types'

const baseSnap: ProSettledSnapshot = {
  text: 'doing the thing',
  marker: { kind: 'WAITING', text: 'q', raw: '[ORCH:WAITING] q' },
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

describe('DOER_SYSTEM_PROMPT_PRO', () => {
  it('mentions DECISION_SHAPE field', () => {
    expect(DOER_SYSTEM_PROMPT_PRO).toContain('DECISION_SHAPE')
  })

  it('lists all six shape names', () => {
    for (const name of ['reply', 'choose', 'approve', 'route', 'validate', 'transition']) {
      expect(DOER_SYSTEM_PROMPT_PRO).toContain(name)
    }
  })

  it('describes the five-stage workflow', () => {
    for (const stage of ['DISCOVERY', 'PLANNING', 'IMPLEMENTATION', 'PHASE REVIEW', 'FINAL REVIEW']) {
      expect(DOER_SYSTEM_PROMPT_PRO).toContain(stage)
    }
  })

  it('forbids editing state.json', () => {
    expect(DOER_SYSTEM_PROMPT_PRO).toMatch(/state\.json.*orchestrator owns it/i)
  })

  it('embeds the principles block', () => {
    for (const name of ['TDD', 'YAGNI', 'VERIFICATION', 'SECURITY', 'BOUNDARY', 'RESEARCH']) {
      expect(DOER_SYSTEM_PROMPT_PRO).toContain(name)
    }
  })

  it('PRINCIPLES_BLOCK lists six principles with severities', () => {
    expect(PRINCIPLES_BLOCK).toContain('hard')
    expect(PRINCIPLES_BLOCK).toContain('soft')
    expect((PRINCIPLES_BLOCK.match(/\*\*/g) ?? []).length).toBeGreaterThanOrEqual(12) // 2 stars per name * 6
  })
})

describe('buildPlannerPrompt — per-shape system prompts', () => {
  it('reply shape teaches the reply schema', () => {
    const p = buildPlannerPrompt(baseInput('reply'))
    expect(p.cachedSystem).toContain('"shape":"reply"')
    expect(p.cachedSystem).toContain('PRINCIPLES')
  })

  it('choose shape teaches the choose schema and YAGNI bias', () => {
    const p = buildPlannerPrompt(baseInput('choose', { options: ['A: small', 'B: large'] }))
    expect(p.cachedSystem).toContain('"shape":"choose"')
    expect(p.cachedSystem).toMatch(/YAGNI/i)
    expect(p.uncachedRecent).toContain('A: small')
  })

  it('approve shape enforces hard-principles override', () => {
    const p = buildPlannerPrompt(baseInput('approve', { artifactPath: 'spec.md', artifactContent: '# spec body' }))
    expect(p.cachedSystem).toContain('"shape":"approve"')
    expect(p.cachedSystem).toMatch(/HARD principles.*MUST override/)
    expect(p.uncachedRecent).toContain('spec.md')
    expect(p.uncachedRecent).toContain('# spec body')
  })

  it('route shape names common skills', () => {
    const p = buildPlannerPrompt(baseInput('route'))
    expect(p.cachedSystem).toContain('"shape":"route"')
    expect(p.cachedSystem).toMatch(/brainstorming|writing-plans|code-reviewer/)
  })

  it('validate shape allows verified or research', () => {
    const p = buildPlannerPrompt(baseInput('validate', { assumption: 'lib X does Y' }))
    expect(p.cachedSystem).toContain('"shape":"validate"')
    expect(p.cachedSystem).toContain('verified')
    expect(p.cachedSystem).toContain('research')
    expect(p.uncachedRecent).toContain('lib X does Y')
  })

  it('transition shape teaches advance/cycle/final-review', () => {
    const p = buildPlannerPrompt(baseInput('transition'))
    expect(p.cachedSystem).toContain('"shape":"transition"')
    expect(p.cachedSystem).toContain('advance')
    expect(p.cachedSystem).toContain('cycle')
    expect(p.cachedSystem).toContain('final-review')
  })

  it('cachedGoalAndArtifacts surfaces validation when present', () => {
    const p = buildPlannerPrompt(baseInput('reply', { validation: { test: 'npm test', build: 'npm run build' } }))
    expect(p.cachedGoalAndArtifacts).toContain('VALIDATION')
    expect(p.cachedGoalAndArtifacts).toContain('npm test')
  })
})

describe('META_REFLECT_SYSTEM_PROMPT + buildMetaReflectPrompt', () => {
  it('META prompt lists three classifications', () => {
    expect(META_REFLECT_SYSTEM_PROMPT).toContain('"classification":"done"')
    expect(META_REFLECT_SYSTEM_PROMPT).toContain('"classification":"extend"')
    expect(META_REFLECT_SYSTEM_PROMPT).toContain('"classification":"human-required"')
  })

  it('META prompt biases toward "done" when uncertain', () => {
    expect(META_REFLECT_SYSTEM_PROMPT).toMatch(/Default to "done"/)
  })

  it('buildMetaReflectPrompt assembles spec + plan + reviews + transcript + cost', () => {
    const p = buildMetaReflectPrompt({
      spec: '# spec body',
      plan: '# plan body',
      reviews: [{ phaseId: 'm1', content: '# m1 review body' }],
      transcriptExcerpt: 'transcript tail here',
      costUsd: 0.4567,
    })
    expect(p).toContain('# spec body')
    expect(p).toContain('# plan body')
    expect(p).toContain('m1')
    expect(p).toContain('# m1 review body')
    expect(p).toContain('transcript tail here')
    expect(p).toContain('$0.4567')
  })

  it('buildMetaReflectPrompt copes with empty reviews', () => {
    const p = buildMetaReflectPrompt({
      spec: 's', plan: 'p', reviews: [], transcriptExcerpt: 't', costUsd: 0,
    })
    expect(p).toContain('(no reviews produced)')
  })
})
