import { normalizeAgentCli, type AgentCli } from '../../shared/agent-cli'

export interface AutopilotRuntime {
  agentCli: AgentCli
  label: string
  clearCommand: string
  permissionReplies: { allow: string; deny: string } | null
}

const RUNTIMES: Record<AgentCli, AutopilotRuntime> = {
  claude: {
    agentCli: 'claude',
    label: 'Claude CLI',
    clearCommand: '/clear',
    permissionReplies: { allow: '1\r', deny: '3\r' },
  },
  codex: {
    agentCli: 'codex',
    label: 'Codex CLI',
    clearCommand: '/clear',
    permissionReplies: null,
  },
  // Grok's TUI is Claude-Code-compatible: numbered permission prompts, /clear.
  grok: {
    agentCli: 'grok',
    label: 'Grok CLI',
    clearCommand: '/clear',
    permissionReplies: { allow: '1\r', deny: '3\r' },
  },
  // Present so the Record stays exhaustive, but Autopilot refuses to start on OpenCode —
  // see getAutopilotRuntimeGuardrail. `/clear` is real (an alias of /new), while
  // permissionReplies is null because OpenCode offers once/always/reject rather than
  // Grok's numbered choices; there is no keystroke to send blind.
  opencode: {
    agentCli: 'opencode',
    label: 'OpenCode CLI',
    clearCommand: '/clear',
    permissionReplies: null,
  },
}

export function getAutopilotRuntime(agentCli: AgentCli = 'claude'): AutopilotRuntime {
  return RUNTIMES[normalizeAgentCli(agentCli)]
}
