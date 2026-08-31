import { AGENT_CLIS, AGENT_CLI_ARGS_PLACEHOLDERS, AGENT_CLI_COMMANDS, AGENT_CLI_LABELS, type AgentCli } from '../../../../shared/agent-cli'
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
  grokArgs: string
  onGrokArgsChange: (v: string) => void
  opencodeArgs: string
  onOpencodeArgsChange: (v: string) => void
  cliAvailability: Record<AgentCli, { available: boolean; path: string | null }> | null
}

export function AgentsPane(p: AgentsPaneProps) {
  const argsByAgent: Record<AgentCli, string> = { claude: p.claudeArgs, codex: p.codexArgs, grok: p.grokArgs, opencode: p.opencodeArgs }
  const setterByAgent: Record<AgentCli, (v: string) => void> = { claude: p.onClaudeArgsChange, codex: p.onCodexArgsChange, grok: p.onGrokArgsChange, opencode: p.onOpencodeArgsChange }
  const activeArgs = argsByAgent[p.agentArgsTab]
  const setActiveArgs = setterByAgent[p.agentArgsTab]
  const activeAvailability = p.cliAvailability?.[p.agentArgsTab]

  return (
    <div>
      <PaneHeading>Agents</PaneHeading>

      {/* These two rows look alike and sit together, so the top one used to read as a
          tab strip — it also moved the args tab below, which reinforced that. Selecting
          it changes which CLI every new project opens with, so it no longer has that
          side effect and says what it does. */}
      <Field
        label="Default Agent CLI"
        hint="Used for folders you have not opened before. Projects you have already opened keep the CLI they last used."
      >
        <PillGroup
          value={p.defaultAgentCli}
          onChange={p.onDefaultAgentCliChange}
          options={AGENT_CLIS.map((cli) => ({
            value: cli,
            label: `${AGENT_CLI_LABELS[cli]} ${p.cliAvailability ? (p.cliAvailability[cli]?.available ? 'available' : 'missing') : ''}`,
          }))}
        />
      </Field>

      <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0 14px' }} />

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
          options={AGENT_CLIS.map((cli) => ({ value: cli, label: AGENT_CLI_LABELS[cli] }))}
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
            placeholder={AGENT_CLI_ARGS_PLACEHOLDERS[p.agentArgsTab]}
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
