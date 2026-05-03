import { describe, expect, it } from 'vitest'
import {
  buildAttachBridgePrompt,
  classifyAttachScrollback,
  createDeterministicAttachDraft,
} from '../src/main/autopilot/attach-session'
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

describe('deterministic attach drafting', () => {
  it('classifies a visible question as waiting_for_user', () => {
    const result = classifyAttachScrollback('Codex\nDo you want to continue?')
    expect(result).toBe('waiting_for_user')
  })

  it('classifies permission prompts separately', () => {
    const result = classifyAttachScrollback('Permission to run npm test?\n1. Yes\n2. No')
    expect(result).toBe('permission_request')
  })

  it('builds a bridge prompt with visible ORCH markers', () => {
    const prompt = buildAttachBridgePrompt({ classification: 'unknown' })
    expect(prompt).toContain('CmdCLD Autopilot is now coordinating this CLI session.')
    expect(prompt).toContain('[ORCH:WAITING]')
    expect(prompt).toContain('[ORCH:PROGRESS]')
    expect(prompt).toContain('[ORCH:GOAL_READY]')
    expect(prompt).toContain('[ORCH:STUCK]')
    expect(prompt).toContain('Keep these markers visible as plain text')
  })

  it('includes the user answer only when provided', () => {
    const prompt = buildAttachBridgePrompt({
      classification: 'waiting_for_user',
      userAnswer: 'Yes, approve that command.',
    })
    expect(prompt).toContain("The user's answer to your current prompt is:")
    expect(prompt).toContain('Yes, approve that command.')
  })

  it('creates a deterministic draft with no token usage', () => {
    const draft = createDeterministicAttachDraft({
      terminalId: 'term-1',
      scrollback: 'Claude is waiting',
      useLlm: false,
      providerConfigured: false,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expect(draft.usedLlm).toBe(false)
    expect(draft.estimatedCostUsd).toBe(0)
    expect(draft.cleanTail.length).toBeGreaterThan(0)
  })
})
