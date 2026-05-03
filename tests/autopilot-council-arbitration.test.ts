import { describe, expect, it } from 'vitest'
import { arbitrateCouncilReview } from '../src/main/autopilot-council/arbitration'
import type { ReviewerDecision } from '../src/main/autopilot-council/types'

function decision(partial: Partial<ReviewerDecision>): ReviewerDecision {
  return {
    verdict: 'approve',
    risk: 'low',
    findings: [],
    recommended_instruction: '',
    rationale: '',
    ...partial,
  }
}

describe('council arbitration', () => {
  it('continues on reviewer approval', () => {
    const result = arbitrateCouncilReview({ gate: 'spec', review: decision({ verdict: 'approve' }), repeatedBlockCount: 0 })
    expect(result.action).toBe('continue')
  })

  it('instructs implementer on concrete refine', () => {
    const result = arbitrateCouncilReview({
      gate: 'plan',
      review: decision({ verdict: 'refine', risk: 'medium', recommended_instruction: 'Add test task.' }),
      repeatedBlockCount: 0,
    })
    expect(result.action).toBe('instruct-implementer')
    expect(result.instruction).toBe('Add test task.')
  })

  it('retries vague refine once', () => {
    const result = arbitrateCouncilReview({
      gate: 'plan',
      review: decision({ verdict: 'refine', risk: 'medium', recommended_instruction: '' }),
      repeatedBlockCount: 0,
    })
    expect(result.action).toBe('retry-reviewer')
  })

  it('lets implementer win low risk disagreement', () => {
    const result = arbitrateCouncilReview({
      gate: 'architecture',
      review: decision({ verdict: 'disagree', risk: 'low', recommended_instruction: 'Use a different name.' }),
      repeatedBlockCount: 0,
    })
    expect(result.action).toBe('implementer-wins')
  })

  it('asks user on high risk disagreement', () => {
    const result = arbitrateCouncilReview({
      gate: 'architecture',
      review: decision({ verdict: 'disagree', risk: 'high', recommended_instruction: 'Do not run migration.' }),
      repeatedBlockCount: 0,
    })
    expect(result.action).toBe('ask-user')
  })

  it('lets implementer win repeated low risk blocks', () => {
    const result = arbitrateCouncilReview({
      gate: 'phase',
      review: decision({ verdict: 'refine', risk: 'low', recommended_instruction: 'Rename variable.' }),
      repeatedBlockCount: 2,
    })
    expect(result.action).toBe('implementer-wins')
  })

  it('asks user on repeated high risk refine', () => {
    const result = arbitrateCouncilReview({
      gate: 'phase',
      review: decision({ verdict: 'refine', risk: 'high', recommended_instruction: 'Do not run migration.' }),
      repeatedBlockCount: 2,
    })
    expect(result.action).toBe('ask-user')
  })

  it('asks user on reviewer escalation', () => {
    const result = arbitrateCouncilReview({
      gate: 'final',
      review: decision({ verdict: 'escalate', risk: 'high', recommended_instruction: 'Human must decide.' }),
      repeatedBlockCount: 0,
    })
    expect(result.action).toBe('ask-user')
  })
})
