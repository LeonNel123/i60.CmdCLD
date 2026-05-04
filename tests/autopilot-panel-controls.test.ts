import { describe, expect, it } from 'vitest'
import { getAttachStatusLabel, getAutopilotPanelControlFlags, getCouncilPanelSummary, shouldAllowAttachDraft } from '../src/renderer/src/components/AutopilotPanel'

describe('Autopilot panel controls', () => {
  it('does not offer resume for blocked Pro runs', () => {
    const flags = getAutopilotPanelControlFlags({ control: 'blocked' })
    expect(flags.isEscalated).toBe(true)
    expect(flags.canPause).toBe(false)
    expect(flags.canResume).toBe(false)
  })

  it('still offers resume for paused runs', () => {
    const flags = getAutopilotPanelControlFlags({ phase: 'paused' })
    expect(flags.isPaused).toBe(true)
    expect(flags.canPause).toBe(false)
    expect(flags.canResume).toBe(true)
  })
})

describe('Autopilot attach panel helpers', () => {
  it('allows attach draft when no run state exists', () => {
    expect(shouldAllowAttachDraft(null)).toBe(true)
  })

  it('blocks attach draft when an autopilot run is active', () => {
    expect(shouldAllowAttachDraft({ phase: 'executing' } as any)).toBe(false)
  })

  it('blocks attach draft when control state is running', () => {
    expect(shouldAllowAttachDraft({ control: 'running' } as any)).toBe(false)
  })

  it('allows attach draft when control state is stopped', () => {
    expect(shouldAllowAttachDraft({ control: 'stopped' } as any)).toBe(true)
  })

  it('blocks attach draft for non-null empty state', () => {
    expect(shouldAllowAttachDraft({} as any)).toBe(false)
  })

  it('formats attach status labels', () => {
    expect(getAttachStatusLabel({ status: 'watching', message: 'Watching from output offset 20.' } as any))
      .toBe('watching: Watching from output offset 20.')
  })
})

describe('getCouncilPanelSummary', () => {
  it('returns null for non-council state', () => {
    expect(getCouncilPanelSummary({ phase: 'executing' })).toBeNull()
  })

  it('summarises council reviewer state', () => {
    expect(getCouncilPanelSummary({
      mode: 'council',
      implementerCli: 'claude',
      reviewerCli: 'codex',
      intensity: 'balanced',
      reviewerStatus: 'idle',
      lastReviewPacketId: '001-spec-review',
      lastCouncilDecision: {
        action: 'implementer-wins',
        gate: 'architecture',
        risk: 'low',
        instruction: '',
        reason: 'Non-high-risk disagreement',
        reviewerVerdict: 'disagree',
      },
    } as any)).toEqual({
      roleLine: 'Claude implements; Codex reviews',
      intensityLine: 'Balanced gates',
      reviewerLine: 'Reviewer: idle',
      decisionLine: 'architecture: implementer-wins (low)',
      packetLine: 'Packet: 001-spec-review',
    })
  })
})
