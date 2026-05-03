import { describe, expect, it } from 'vitest'
import { buildCouncilImplementerPrompt, buildCouncilReviewerPrompt } from '../src/main/autopilot-council/prompts'

describe('autopilot council prompts', () => {
  it('states implementer owns all writes', () => {
    const prompt = buildCouncilImplementerPrompt('codex')
    expect(prompt).toContain('Autopilot Council')
    expect(prompt).toContain('You are the Implementer')
    expect(prompt).toContain('The Reviewer never edits files')
    expect(prompt).toContain('DO NOT commit locally')
  })

  it('allows Claude implementer commits by following existing behavior', () => {
    const prompt = buildCouncilImplementerPrompt('claude')
    expect(prompt).toContain('You are the Implementer')
    expect(prompt).not.toContain('DO NOT commit locally')
  })

  it('forces reviewer JSON and read-only behavior', () => {
    const prompt = buildCouncilReviewerPrompt('claude')
    expect(prompt).toContain('You are the Council Reviewer')
    expect(prompt).toContain('Do not edit files')
    expect(prompt).toContain('Return JSON only')
    expect(prompt).toContain('"verdict"')
  })
})
