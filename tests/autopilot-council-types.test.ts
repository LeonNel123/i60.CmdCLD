import { describe, expect, it } from 'vitest'
import {
  COUNCIL_DIR,
  COUNCIL_GATES_BY_INTENSITY,
  HIGH_RISK_CATEGORIES,
  isCouncilGate,
  isCouncilIntensity,
  isReviewerRisk,
  isReviewerVerdict,
} from '../src/main/autopilot-council/types'

describe('autopilot council types', () => {
  it('uses the expected artifact directory', () => {
    expect(COUNCIL_DIR).toBe('.autopilot-council')
  })

  it('validates intensities and reviewer verdicts', () => {
    expect(isCouncilIntensity('light')).toBe(true)
    expect(isCouncilIntensity('balanced')).toBe(true)
    expect(isCouncilIntensity('strict')).toBe(true)
    expect(isCouncilIntensity('everything')).toBe(false)

    expect(isReviewerVerdict('approve')).toBe(true)
    expect(isReviewerVerdict('refine')).toBe(true)
    expect(isReviewerVerdict('disagree')).toBe(true)
    expect(isReviewerVerdict('escalate')).toBe(true)
    expect(isReviewerVerdict('block')).toBe(false)

    expect(isReviewerRisk('low')).toBe(true)
    expect(isReviewerRisk('medium')).toBe(true)
    expect(isReviewerRisk('high')).toBe(true)
    expect(isReviewerRisk('critical')).toBe(false)
  })

  it('maps intensity to gates', () => {
    expect(COUNCIL_GATES_BY_INTENSITY.light).toEqual(['spec', 'plan', 'final'])
    expect(COUNCIL_GATES_BY_INTENSITY.balanced).toEqual([
      'spec',
      'plan',
      'architecture',
      'stuck',
      'phase',
      'final',
    ])
    expect(COUNCIL_GATES_BY_INTENSITY.strict).toContain('task')
  })

  it('knows valid gate names and high risk categories', () => {
    expect(isCouncilGate('phase')).toBe(true)
    expect(isCouncilGate('daily')).toBe(false)
    expect(HIGH_RISK_CATEGORIES).toContain('security')
    expect(HIGH_RISK_CATEGORIES).toContain('boundary')
  })
})
