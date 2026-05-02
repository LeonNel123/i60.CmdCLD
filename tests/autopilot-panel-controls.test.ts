import { describe, expect, it } from 'vitest'
import { getAutopilotPanelControlFlags } from '../src/renderer/src/components/AutopilotPanel'

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
