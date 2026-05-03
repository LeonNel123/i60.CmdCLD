import { describe, expect, it } from 'vitest'
import { ATTACH_CLASSIFICATIONS, ATTACH_LIFECYCLE_STATUSES } from '../src/main/autopilot/attach-types'
import type { AttachDraftRequest } from '../src/main/autopilot/attach-types'

describe('autopilot attach types', () => {
  it('allows the expected attach classification values', () => {
    expect(ATTACH_CLASSIFICATIONS).toEqual([
      'idle',
      'waiting_for_user',
      'permission_request',
      'working',
      'blocked',
      'unknown',
    ])
    expect(ATTACH_CLASSIFICATIONS).toContain('waiting_for_user')
  })

  it('describes a draft request without requiring a goal', () => {
    const request: AttachDraftRequest = {
      terminalId: 'term-1',
      scrollback: 'Codex is asking for input',
      useLlm: false,
      userAnswer: 'Proceed with the focused fix.',
      providerConfigured: false,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }
    expect(request.userAnswer).toContain('focused fix')
  })

  it('has visible lifecycle statuses for diagnostics', () => {
    expect(ATTACH_LIFECYCLE_STATUSES).toEqual([
      'drafting',
      'drafted',
      'sending_bridge',
      'watching',
      'attached',
      'no_marker_yet',
      'failed',
      'cancelled',
    ])
    expect(ATTACH_LIFECYCLE_STATUSES).toContain('no_marker_yet')
  })
})
