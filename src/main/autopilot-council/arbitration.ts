import type {
  CouncilArbitrationResult,
  CouncilGate,
  ReviewerDecision,
} from './types'

export interface CouncilArbitrationArgs {
  gate: CouncilGate
  review: ReviewerDecision
  repeatedBlockCount: number
}

export function arbitrateCouncilReview(args: CouncilArbitrationArgs): CouncilArbitrationResult {
  const { gate, review, repeatedBlockCount } = args
  const instruction = review.recommended_instruction.trim()

  if (review.verdict === 'approve') {
    return {
      action: 'continue',
      gate,
      risk: review.risk,
      instruction,
      reason: 'reviewer-approved',
      reviewerVerdict: review.verdict,
    }
  }

  if (review.verdict === 'escalate') {
    return {
      action: 'ask-user',
      gate,
      risk: review.risk,
      instruction,
      reason: 'reviewer-escalated',
      reviewerVerdict: review.verdict,
    }
  }

  if (review.verdict === 'disagree') {
    return {
      action: review.risk === 'high' ? 'ask-user' : 'implementer-wins',
      gate,
      risk: review.risk,
      instruction,
      reason: review.risk === 'high' ? 'high-risk-disagreement' : 'low-risk-disagreement',
      reviewerVerdict: review.verdict,
    }
  }

  if (!instruction) {
    return {
      action: 'retry-reviewer',
      gate,
      risk: review.risk,
      instruction,
      reason: 'empty-refine-instruction',
      reviewerVerdict: review.verdict,
    }
  }

  if (repeatedBlockCount >= 2) {
    return {
      action: review.risk === 'high' ? 'ask-user' : 'implementer-wins',
      gate,
      risk: review.risk,
      instruction,
      reason: review.risk === 'high' ? 'repeated-high-risk-refine' : 'repeated-low-risk-refine',
      reviewerVerdict: review.verdict,
    }
  }

  return {
    action: 'instruct-implementer',
    gate,
    risk: review.risk,
    instruction,
    reason: 'reviewer-requested-refine',
    reviewerVerdict: review.verdict,
  }
}
