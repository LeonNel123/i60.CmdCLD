import { AGENT_CLI_COMMANDS, AGENT_CLI_LABELS, type AgentCli } from '../../../../shared/agent-cli'
import { AgentLaunchOptions } from '../AgentLaunchOptions'
import { Field, PaneHeading, PillGroup, TextInput } from './controls'

export interface AgentsPaneProps {
  defaultAgentCli: AgentCli
  onDefaultAgentCliChange: (cli: AgentCli) => void
  agentArgsTab: AgentCli
  onAgentArgsTabChange: (cli: AgentCli) => void
  claudeArgs: string
  onClaudeArgsChange: (v: string) => void
  codexArgs: string
  onCodexArgsChange: (v: string) => void
  cliAvailability: Record<AgentCli, { available: boolean; path: string | null }> | null
}

export function AgentsPane(p: AgentsPaneProps) {
  const activeArgs = p.agentArgsTab === 'codex' ? p.codexArgs : p.claudeArgs
  const setActiveArgs = p.agentArgsTab === 'codex' ? p.onCodexArgsChange : p.onClaudeArgsChange
  const activeAvailability = p.cliAvailability?.[p.agentArgsTab]

  return (
    <div>
      <PaneHeading>Agents</PaneHeading>

      <Field label="Default Agent CLI">
        <PillGroup
          value={p.defaultAgentCli}
          onChange={(cli) => { p.onDefaultAgentCliChange(cli); p.onAgentArgsTabChange(cli) }}
          options={(['claude', 'codex'] as AgentCli[]).map((cli) => ({
            value: cli,
            label: `${AGENT_CLI_LABELS[cli]} ${p.cliAvailability ? (p.cliAvailability[cli]?.available ? 'available' : 'missing') : ''}`,
          }))}
        />
      </Field>

      <Field
        label="Edit Launch Arguments For"
        hint={
          <span style={{ color: activeAvailability?.available === false ? '#ef4444' : undefined }}>
            {p.cliAvailability
              ? activeAvailability?.available
                ? `${AGENT_CLI_COMMANDS[p.agentArgsTab]} found at ${activeAvailability.path}`
                : `${AGENT_CLI_COMMANDS[p.agentArgsTab]} was not found on PATH`
              : 'Checking installed CLIs...'}
          </span>
        }
      >
        <PillGroup
          value={p.agentArgsTab}
          onChange={p.onAgentArgsTabChange}
          options={(['claude', 'codex'] as AgentCli[]).map((cli) => ({ value: cli, label: AGENT_CLI_LABELS[cli] }))}
        />
      </Field>

      <Field label="Launch Options">
        <AgentLaunchOptions agentCli={p.agentArgsTab} args={activeArgs} onArgsChange={setActiveArgs} />
      </Field>

      <Field
        label="Default Launch Arguments"
        hint={`These flags are passed to \`${AGENT_CLI_COMMANDS[p.agentArgsTab]}\` when opening a new terminal`}
      >
        <div style={{ display: 'flex', gap: '6px' }}>
          <TextInput
            mono
            value={activeArgs}
            onChange={(e) => setActiveArgs(e.target.value)}
            placeholder={p.agentArgsTab === 'codex' ? 'e.g. --sandbox workspace-write' : 'e.g. --dangerously-skip-permissions --continue'}
            style={{ flex: 1, width: undefined }}
          />
          <button
            onClick={() => setActiveArgs('')}
            title="Clear"
            style={{
              background: '#333', border: '1px solid #444', borderRadius: '4px',
              padding: '0 10px', color: '#999', fontSize: '11px', fontFamily: 'inherit',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            Clear
          </button>
        </div>
      </Field>
    </div>
  )
}
