export type AgentCli = 'claude' | 'codex'

export interface AgentCliPreset {
  label: string
  args: string
}

export interface AgentArgsSettings {
  claudeArgs?: string
  codexArgs?: string
}

export const DEFAULT_AGENT_CLI: AgentCli = 'claude'

export const AGENT_CLI_LABELS: Record<AgentCli, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

export const AGENT_CLI_COMMANDS: Record<AgentCli, string> = {
  claude: 'claude',
  codex: 'codex',
}

export const AGENT_CLI_PRESETS: Record<AgentCli, AgentCliPreset[]> = {
  claude: [
    { label: 'Default (no flags)', args: '' },
    { label: 'Continue', args: '--continue' },
    { label: 'Skip Permissions', args: '--dangerously-skip-permissions' },
    { label: 'Skip + Continue', args: '--dangerously-skip-permissions --continue' },
    { label: 'Auto Mode', args: '--permission-mode auto' },
    { label: 'Accept Edits', args: '--permission-mode acceptEdits' },
    { label: 'Plan Mode', args: '--permission-mode plan' },
    { label: 'Opus + Skip', args: '--dangerously-skip-permissions --model opus' },
    { label: 'Sonnet + High Effort', args: '--model sonnet --effort high' },
    { label: 'Opus + Max Effort', args: '--model opus --effort max' },
    { label: 'Haiku (fast)', args: '--model haiku' },
  ],
  codex: [
    { label: 'Default (no flags)', args: '' },
    { label: 'Workspace Write', args: '--sandbox workspace-write' },
    { label: 'Read Only', args: '--sandbox read-only' },
    { label: 'Full Access', args: '--sandbox danger-full-access' },
    { label: 'On Request', args: '--ask-for-approval on-request' },
    { label: 'Never Ask', args: '--ask-for-approval never' },
    { label: 'Full Auto', args: '--dangerously-bypass-approvals-and-sandbox' },
    { label: 'Resume Last', args: 'resume --last' },
    { label: 'Search Enabled', args: '--search' },
  ],
}

export function normalizeAgentCli(value: unknown): AgentCli {
  return value === 'codex' ? 'codex' : DEFAULT_AGENT_CLI
}

export function getArgsForAgent(agentCli: AgentCli, settings: AgentArgsSettings): string {
  return agentCli === 'codex' ? settings.codexArgs || '' : settings.claudeArgs || ''
}

export function buildAgentLaunchCommand(agentCli: AgentCli, args: string | undefined): string {
  const command = AGENT_CLI_COMMANDS[agentCli]
  const trimmed = (args || '').trim()
  return trimmed ? `${command} ${trimmed}\r` : `${command}\r`
}

export function stripResumeArgsForQuickLaunch(agentCli: AgentCli, args: string): string {
  let next = args
  if (agentCli === 'claude') {
    next = next.replace(/(^|\s)(--continue|-c)(?=\s|$)/g, ' ')
  } else {
    next = next.replace(/(^|\s)resume(\s+--last)?(?=\s|$)/g, ' ')
  }
  return next.replace(/\s+/g, ' ').trim()
}
