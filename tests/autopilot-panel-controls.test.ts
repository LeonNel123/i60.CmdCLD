import { describe, expect, it } from 'vitest'
import { getAttachStatusLabel, getAutopilotPanelControlFlags, shouldAllowAttachDraft } from '../src/renderer/src/components/AutopilotPanel'

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

  it('formats attach status labels', () => {
    expect(getAttachStatusLabel({ status: 'watching', message: 'Watching from output offset 20.' } as any))
      .toBe('watching: Watching from output offset 20.')
  })
})
