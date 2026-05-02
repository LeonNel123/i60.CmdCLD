import { describe, expect, it } from 'vitest'
import {
  AGENT_CLI_PRESETS,
  buildAgentLaunchCommand,
  getArgsForAgent,
  normalizeAgentCli,
  stripResumeArgsForQuickLaunch,
} from '../src/shared/agent-cli'

describe('agent CLI utilities', () => {
  it('defaults unknown or missing provider values to Claude', () => {
    expect(normalizeAgentCli(undefined)).toBe('claude')
    expect(normalizeAgentCli('')).toBe('claude')
    expect(normalizeAgentCli('claude')).toBe('claude')
    expect(normalizeAgentCli('codex')).toBe('codex')
    expect(normalizeAgentCli('other')).toBe('claude')
  })

  it('returns provider-specific launch args while preserving legacy Claude args', () => {
    expect(getArgsForAgent('claude', { claudeArgs: '--continue', codexArgs: '--sandbox workspace-write' })).toBe('--continue')
    expect(getArgsForAgent('codex', { claudeArgs: '--continue', codexArgs: '--sandbox workspace-write' })).toBe('--sandbox workspace-write')
    expect(getArgsForAgent('codex', { claudeArgs: '--continue' })).toBe('')
  })

  it('builds the interactive launch command for Claude and Codex', () => {
    expect(buildAgentLaunchCommand('claude', '')).toBe('claude\r')
    expect(buildAgentLaunchCommand('claude', ' --continue ')).toBe('claude --continue\r')
    expect(buildAgentLaunchCommand('codex', '')).toBe('codex\r')
    expect(buildAgentLaunchCommand('codex', ' --sandbox workspace-write ')).toBe('codex --sandbox workspace-write\r')
    expect(buildAgentLaunchCommand('codex', 'resume --last')).toBe('codex resume --last\r')
  })

  it('removes resume flags for quick launches without mutating unrelated args', () => {
    expect(stripResumeArgsForQuickLaunch('claude', '--continue --model sonnet')).toBe('--model sonnet')
    expect(stripResumeArgsForQuickLaunch('claude', '-c --model sonnet')).toBe('--model sonnet')
    expect(stripResumeArgsForQuickLaunch('codex', 'resume --last --model gpt-5.4')).toBe('--model gpt-5.4')
    expect(stripResumeArgsForQuickLaunch('codex', '--sandbox workspace-write')).toBe('--sandbox workspace-write')
  })

  it('defines separate presets for Claude and Codex', () => {
    expect(AGENT_CLI_PRESETS.claude.some((p) => p.args.includes('--dangerously-skip-permissions'))).toBe(true)
    expect(AGENT_CLI_PRESETS.codex.some((p) => p.args.includes('--sandbox workspace-write'))).toBe(true)
    expect(AGENT_CLI_PRESETS.codex.some((p) => p.args.includes('--ask-for-approval never'))).toBe(true)
  })
})
