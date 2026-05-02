import type { AgentCli } from '../../shared/agent-cli'

export interface AutopilotRuntime {
  agentCli: AgentCli
  label: string
  clearCommand: string
  permissionReplies: { allow: string; deny: string } | null
}

export function getAutopilotRuntime(agentCli: AgentCli = 'claude'): AutopilotRuntime {
  if (agentCli === 'codex') {
    return {
      agentCli: 'codex',
      label: 'Codex CLI',
      clearCommand: '/clear',
      permissionReplies: null,
    }
  }

  return {
    agentCli: 'claude',
    label: 'Claude CLI',
    clearCommand: '/clear',
    permissionReplies: { allow: '1\r', deny: '3\r' },
  }
}
