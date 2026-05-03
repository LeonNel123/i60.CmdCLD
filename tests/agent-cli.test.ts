import { describe, expect, it } from 'vitest'
import {
  AGENT_CLI_OPTION_GROUPS,
  applyAgentCliLaunchOption,
  buildAgentLaunchCommand,
  getArgsForAgent,
  getActiveAgentCliLaunchOptionIds,
  getAutopilotRuntimeGuardrail,
  getCouncilReviewerRuntimeGuardrail,
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

  it('defines composable launch option groups for Claude and Codex', () => {
    expect(AGENT_CLI_OPTION_GROUPS.claude.some((g) => g.id === 'permission')).toBe(true)
    expect(AGENT_CLI_OPTION_GROUPS.codex.some((g) => g.id === 'sandbox')).toBe(true)
    expect(AGENT_CLI_OPTION_GROUPS.codex.some((g) => g.id === 'approval')).toBe(true)
  })

  it('stacks independent Codex options while replacing mutually exclusive options', () => {
    let args = ''
    args = applyAgentCliLaunchOption('codex', args, 'codex-sandbox-workspace-write')
    args = applyAgentCliLaunchOption('codex', args, 'codex-approval-never')
    args = applyAgentCliLaunchOption('codex', args, 'codex-search')
    expect(args).toBe('--sandbox workspace-write --ask-for-approval never --search')

    args = applyAgentCliLaunchOption('codex', args, 'codex-sandbox-danger-full-access')
    expect(args).toBe('--ask-for-approval never --search --sandbox danger-full-access')
    expect(getActiveAgentCliLaunchOptionIds('codex', args)).toEqual([
      'codex-sandbox-danger-full-access',
      'codex-approval-never',
      'codex-search',
    ])
  })

  it('treats the Codex dangerous bypass as mutually exclusive with sandbox and approval flags', () => {
    let args = '--sandbox workspace-write --ask-for-approval never --search'
    args = applyAgentCliLaunchOption('codex', args, 'codex-dangerous-bypass')
    expect(args).toBe('--search --dangerously-bypass-approvals-and-sandbox')

    args = applyAgentCliLaunchOption('codex', args, 'codex-sandbox-read-only')
    expect(args).toBe('--search --sandbox read-only')
  })

  it('adds a Codex sandboxed full-auto preset for Autopilot', () => {
    const args = applyAgentCliLaunchOption('codex', '', 'codex-autopilot-full-auto')
    expect(args).toBe('--sandbox workspace-write --ask-for-approval never --search')
    expect(getAutopilotRuntimeGuardrail('codex', args).canStart).toBe(true)
  })

  it('applies the Codex Autopilot preset without duplicating existing component options', () => {
    const args = applyAgentCliLaunchOption(
      'codex',
      '--search --sandbox danger-full-access --ask-for-approval on-request',
      'codex-autopilot-full-auto',
    )
    expect(args).toBe('--sandbox workspace-write --ask-for-approval never --search')
  })

  it('allows Codex Autopilot only when full-auto is sandboxed to workspace writes', () => {
    const ok = getAutopilotRuntimeGuardrail('codex', '--sandbox workspace-write --ask-for-approval never --search')
    expect(ok.canStart).toBe(true)
    expect(ok.agentCli).toBe('codex')
    expect(ok.warnings).toEqual([])

    expect(getAutopilotRuntimeGuardrail('codex', '--sandbox danger-full-access --ask-for-approval never').canStart).toBe(false)
    expect(getAutopilotRuntimeGuardrail('codex', '--dangerously-bypass-approvals-and-sandbox').canStart).toBe(false)
    expect(getAutopilotRuntimeGuardrail('codex', '--sandbox read-only --ask-for-approval never').canStart).toBe(false)
    expect(getAutopilotRuntimeGuardrail('codex', '--sandbox workspace-write --ask-for-approval on-request').canStart).toBe(false)
  })

  it('recognizes Codex guardrail aliases and equals syntax', () => {
    expect(getAutopilotRuntimeGuardrail('codex', '-s workspace-write -a never --search').canStart).toBe(true)
    expect(getAutopilotRuntimeGuardrail('codex', '--sandbox=workspace-write --ask-for-approval=never').canStart).toBe(true)
    expect(getAutopilotRuntimeGuardrail('codex', '-s danger-full-access -a never').canStart).toBe(false)
    expect(getAutopilotRuntimeGuardrail('codex', '--sandbox=read-only --ask-for-approval=never').canStart).toBe(false)
    expect(getAutopilotRuntimeGuardrail('codex', '--sandbox=workspace-write --ask-for-approval=on-request').canStart).toBe(false)
  })

  it('keeps Claude Autopilot launchable while warning on bypass permissions', () => {
    const guardrail = getAutopilotRuntimeGuardrail('claude', '--dangerously-skip-permissions')
    expect(guardrail.canStart).toBe(true)
    expect(guardrail.agentCli).toBe('claude')
    expect(guardrail.warnings.join(' ')).toMatch(/permission/i)
  })

  it('recognizes Claude permission bypass equals syntax', () => {
    const guardrail = getAutopilotRuntimeGuardrail('claude', '--permission-mode=bypassPermissions')
    expect(guardrail.canStart).toBe(true)
    expect(guardrail.warnings.join(' ')).toMatch(/permission/i)
  })

  it('stacks Claude session, model, and effort options while replacing permission modes', () => {
    let args = ''
    args = applyAgentCliLaunchOption('claude', args, 'claude-continue')
    args = applyAgentCliLaunchOption('claude', args, 'claude-permission-plan')
    args = applyAgentCliLaunchOption('claude', args, 'claude-model-opus')
    args = applyAgentCliLaunchOption('claude', args, 'claude-effort-high')
    expect(args).toBe('--continue --permission-mode plan --model opus --effort high')

    args = applyAgentCliLaunchOption('claude', args, 'claude-skip-permissions')
    expect(args).toBe('--continue --model opus --effort high --dangerously-skip-permissions')
  })
})

describe('getCouncilReviewerRuntimeGuardrail', () => {
  it('allows Claude reviewer sessions', () => {
    const result = getCouncilReviewerRuntimeGuardrail('claude', '--permission-mode default')
    expect(result.canStart).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('warns when Claude reviewer bypasses permissions', () => {
    const result = getCouncilReviewerRuntimeGuardrail('claude', '--dangerously-skip-permissions')
    expect(result.canStart).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/permission bypass/i)
  })

  it('allows Codex reviewer sessions in read-only mode', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', '--sandbox read-only --ask-for-approval never --search')
    expect(result.canStart).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.warnings).toEqual([])
  })

  it('blocks Codex reviewer resume sessions', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', 'resume --last --sandbox read-only --ask-for-approval never')
    expect(result.canStart).toBe(false)
    expect(result.reason).toContain('resume --last')
  })

  it('blocks dangerous Codex reviewer bypass', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', '--dangerously-bypass-approvals-and-sandbox')
    expect(result.canStart).toBe(false)
    expect(result.reason).toContain('blocks')
  })

  it('blocks Codex reviewer full filesystem access', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', '--sandbox danger-full-access --ask-for-approval never')
    expect(result.canStart).toBe(false)
    expect(result.reason).toContain('danger-full-access')
  })

  it('warns when Codex reviewer has workspace write access', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', '--sandbox workspace-write --ask-for-approval never')
    expect(result.canStart).toBe(true)
    expect(result.warnings.join(' ')).toContain('read-only')
  })

  it('warns when Codex reviewer is missing explicit sandbox mode', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', '--ask-for-approval never --search')
    expect(result.canStart).toBe(true)
    expect(result.warnings.join(' ')).toContain('--sandbox read-only')
  })

  it('warns when Codex reviewer is missing never approval mode', () => {
    const missing = getCouncilReviewerRuntimeGuardrail('codex', '--sandbox read-only --search')
    expect(missing.canStart).toBe(true)
    expect(missing.warnings.join(' ')).toContain('--ask-for-approval never')

    const onRequest = getCouncilReviewerRuntimeGuardrail('codex', '--sandbox read-only --ask-for-approval on-request')
    expect(onRequest.canStart).toBe(true)
    expect(onRequest.warnings.join(' ')).toContain('--ask-for-approval never')
  })

  it('warns when Codex reviewer uses full-auto instead of explicit reviewer guardrails', () => {
    const result = getCouncilReviewerRuntimeGuardrail('codex', '--full-auto')
    expect(result.canStart).toBe(true)
    expect(result.warnings.join(' ')).toContain('read-only')
    expect(result.warnings.join(' ')).toContain('ask-for-approval never')
  })
})
