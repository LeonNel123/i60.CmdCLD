import { describe, expect, it } from 'vitest'
import { getAutopilotRuntime } from '../src/main/autopilot/runtime'

describe('getAutopilotRuntime', () => {
  it('gives claude numbered permission replies', () => {
    expect(getAutopilotRuntime('claude')).toEqual({
      agentCli: 'claude',
      label: 'Claude CLI',
      clearCommand: '/clear',
      permissionReplies: { allow: '1\r', deny: '3\r' },
    })
  })

  it('gives codex no permission replies', () => {
    expect(getAutopilotRuntime('codex')).toEqual({
      agentCli: 'codex',
      label: 'Codex CLI',
      clearCommand: '/clear',
      permissionReplies: null,
    })
  })

  it('gives grok claude-style numbered permission replies', () => {
    expect(getAutopilotRuntime('grok')).toEqual({
      agentCli: 'grok',
      label: 'Grok CLI',
      clearCommand: '/clear',
      permissionReplies: { allow: '1\r', deny: '3\r' },
    })
  })

  it('defaults unknown CLIs to the claude runtime', () => {
    expect(getAutopilotRuntime(undefined).agentCli).toBe('claude')
  })
})
