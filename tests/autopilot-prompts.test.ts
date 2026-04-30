import { describe, it, expect } from 'vitest'
import { DOER_SYSTEM_PROMPT } from '../src/main/autopilot/prompts'

describe('DOER_SYSTEM_PROMPT', () => {
  it('includes ITERATION DISCIPLINE language', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/ITERATION DISCIPLINE/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/while I'm at it/)
  })

  it('includes PRE-COMMIT CHECKS with five mechanical items', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/PRE-COMMIT CHECKS/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Run the full test suite/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/Run the build/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/grep/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/RED phase|failing test/i)
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary/i)
  })

  it('forbids `git add -A`, `git add .`, `git add -u`', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/git add -A/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/git add \./)
    expect(DOER_SYSTEM_PROMPT).toMatch(/git add -u/)
  })

  it('forbids committing internal .autopilot files but allows the spec files', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/state\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/log\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/learnings\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/goal\.md/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/milestones\//)
  })

  it('describes the Status Report structured block', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/STATUS:/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/FILES_CHANGED/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/BOUNDARY_OK/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/RED_PHASE/)
  })

  it('mentions the boundary block on subgoals', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/boundary:/)
    expect(DOER_SYSTEM_PROMPT).toMatch(/STUCK.*boundary violation/i)
  })

  it('mentions learnings.md as append-only', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/learnings\.md/)
  })

  it('mentions steering files as authoritative', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/tech\.md|structure\.md/)
  })

  it('mentions EARS-form acceptance evaluation', () => {
    expect(DOER_SYSTEM_PROMPT).toMatch(/WHEN .* SHALL/)
  })
})
