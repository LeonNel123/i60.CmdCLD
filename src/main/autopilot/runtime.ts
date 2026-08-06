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
}

export function getAutopilotRuntime(agentCli: AgentCli = 'claude'): AutopilotRuntime {
  return RUNTIMES[normalizeAgentCli(agentCli)]
}
