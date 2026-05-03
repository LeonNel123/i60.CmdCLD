import { describe, expect, it } from 'vitest'
import type { AttachClassification, AttachDraftRequest, AttachLifecycleStatus } from '../src/main/autopilot/attach-types'

describe('autopilot attach types', () => {
  it('allows the expected attach classification values', () => {
    const classifications: AttachClassification[] = [
      'idle',
      'waiting_for_user',
      'permission_request',
      'working',
      'blocked',
      'unknown',
    ]
    expect(classifications).toContain('waiting_for_user')
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
    const statuses: AttachLifecycleStatus[] = [
      'drafting',
      'drafted',
      'sending_bridge',
      'watching',
      'attached',
      'no_marker_yet',
      'failed',
      'cancelled',
    ]
    expect(statuses).toContain('no_marker_yet')
  })
})
