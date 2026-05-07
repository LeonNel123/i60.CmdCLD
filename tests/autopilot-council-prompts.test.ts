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
    expect(prompt).toContain('Do not run mutating commands')
    expect(prompt).toContain('untrusted state')
    expect(prompt).toContain('Return JSON only')
    expect(prompt).toContain('No prose outside the JSON object')
    expect(prompt).toContain('do not invent files')
    expect(prompt).toContain('Anchor every finding')
    expect(prompt).toContain('"verdict"')
  })

  it('shows reviewer schema as a valid JSON example', () => {
    const prompt = buildCouncilReviewerPrompt('claude')
    const match = prompt.match(/Example JSON object:\n([\s\S]*?)\n\nAllowed values:/)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match?.[1] ?? '')).not.toThrow()
  })

  it("points the Implementer at .autopilot-council's control dir, not .autopilot-pro", () => {
    const p = buildCouncilImplementerPrompt('claude')
    expect(p).toMatch(/\.autopilot-council\/outbox\/marker\.json/)
    expect(p).toMatch(/\.autopilot-council\/inbox\/reply\.txt/)
    expect(p).not.toMatch(/\.autopilot-pro\/outbox\/marker\.json/)
  })
})
