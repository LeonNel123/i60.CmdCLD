import {
  AGENT_CLI_OPTION_GROUPS,
  applyAgentCliLaunchOption,
  getActiveAgentCliLaunchOptionIds,
  type AgentCli,
  type AgentCliLaunchOption,
} from '../../../shared/agent-cli'

interface AgentLaunchOptionsProps {
  agentCli: AgentCli
  args: string
  onArgsChange: (args: string) => void
}

export function AgentLaunchOptions({ agentCli, args, onArgsChange }: AgentLaunchOptionsProps) {
  const activeIds = new Set(getActiveAgentCliLaunchOptionIds(agentCli, args))
  const groups = AGENT_CLI_OPTION_GROUPS[agentCli]

  const buttonStyle = (option: AgentCliLaunchOption, active: boolean): React.CSSProperties => ({
    background: active ? (option.dangerous ? '#ef444420' : '#22c55e20') : '#ffffff08',
    border: active ? `1px solid ${option.dangerous ? '#ef4444' : '#22c55e'}` : '1px solid #333',
    borderRadius: '4px',
    padding: '3px 8px',
    color: active ? (option.dangerous ? '#f87171' : '#22c55e') : '#aaa',
    fontSize: '11px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '12px' }}>
      {groups.map((group) => (
        <div key={group.id}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '5px' }}>
            {group.label}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {group.options.map((option) => {
              const active = activeIds.has(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.args}
                  onClick={() => onArgsChange(applyAgentCliLaunchOption(agentCli, args, option.id))}
                  style={buttonStyle(option, active)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
