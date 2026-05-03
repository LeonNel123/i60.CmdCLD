import { describe, expect, it } from 'vitest'
import {
  buildReviewPacket,
  formatReviewPacketForReviewer,
  parseReviewerDecision,
  trimForPacket,
} from '../src/main/autopilot-council/packets'

describe('autopilot council packets', () => {
  it('trims from the end with an omitted prefix marker', () => {
    const text = 'a'.repeat(50) + 'tail'
    expect(trimForPacket(text, 10)).toBe('[trimmed 44 chars]\naaaaaatail')
  })

  it('builds packet ids with gate and sequence', () => {
    const packet = buildReviewPacket({
      sequence: 7,
      gate: 'plan',
      stage: 'planning',
      projectPath: 'D:/repo',
      goalSummary: 'ship council mode',
      implementerCli: 'codex',
      reviewerCli: 'claude',
      marker: null,
      artifactPath: 'plan.md',
      artifactContent: '# Plan\n' + 'x'.repeat(5000),
      diffSummary: 'src/file.ts changed',
      filesChanged: ['src/file.ts'],
      testEvidence: '12 passed',
      recentDecisions: ['approved spec'],
      terminalTail: 'latest output',
    })
    expect(packet.id).toBe('007-plan-review')
    expect(packet.artifactExcerpt?.length).toBeLessThan(4200)
  })

  it('formats reviewer packets as markdown with clear sections', () => {
    const packet = buildReviewPacket({
      sequence: 1,
      gate: 'spec',
      stage: 'discovery',
      projectPath: 'D:/repo',
      goalSummary: 'goal',
      implementerCli: 'claude',
      reviewerCli: 'codex',
      marker: null,
      artifactPath: 'spec.md',
      artifactContent: '# Spec',
      diffSummary: null,
      filesChanged: [],
      testEvidence: null,
      recentDecisions: [],
      terminalTail: '',
    })
    const text = formatReviewPacketForReviewer(packet)
    expect(text).toContain('# Council Review Packet 001-spec-review')
    expect(text).toContain('Gate: spec')
    expect(text).toContain('## Reviewer Task')
    expect(text).toContain('## Terminal Tail')
    expect(text).toContain('(empty)')
  })

  it('parses direct reviewer JSON', () => {
    const parsed = parseReviewerDecision(JSON.stringify({
      verdict: 'refine',
      risk: 'medium',
      findings: [{ title: 'Missing test', severity: 'warning', reason: 'No test evidence', recommended_fix: 'Run npm test' }],
      recommended_instruction: 'Run npm test before continuing.',
      rationale: 'Verification is missing.',
    }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.decision.verdict).toBe('refine')
      expect(parsed.decision.findings[0].title).toBe('Missing test')
    }
  })

  it('extracts JSON from noisy reviewer output', () => {
    const parsed = parseReviewerDecision('text before {"verdict":"approve","risk":"low","findings":[],"recommended_instruction":"","rationale":"ok"} text after')
    expect(parsed.ok).toBe(true)
  })

  it('rejects invalid reviewer JSON schema', () => {
    const parsed = parseReviewerDecision('{"verdict":"block","risk":"low","findings":[]}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('verdict')
  })

  it('rejects invalid reviewer finding shape', () => {
    const parsed = parseReviewerDecision('{"verdict":"approve","risk":"low","findings":[{"title":"x"}],"recommended_instruction":"","rationale":""}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('finding')
  })
})
