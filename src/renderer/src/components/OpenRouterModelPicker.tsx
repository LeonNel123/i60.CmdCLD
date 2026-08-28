import { PINNED_OPENROUTER_MODELS, type AgentCli } from '../../../shared/agent-cli'
import { getOpenRouterModel, setOpenRouterModel } from '../../../shared/openrouter-model'
import { OpenRouterModelSearch, useOpenRouterCatalogue, formatRate } from './OpenRouterModelSearch'

/**
 * Model selection for the CLIs that can be pointed at OpenRouter.
 *
 * Deliberately not a row of buttons like the other launch options: the catalogue holds
 * ~330 tool-capable models and turns over without a release of this app, so the model
 * lives in the launch args (see shared/openrouter-model.ts) rather than being a
 * launch-option id, which would have to exist at build time.
 *
 * Search hides models without tool support. An agent CLI drives its entire loop through
 * tool calls, so such a model does not merely underperform — it cannot edit a file.
 */
interface Props {
  agentCli: AgentCli
  args: string
  onArgsChange: (args: string) => void
}

export function OpenRouterModelPicker({ agentCli, args, onArgsChange }: Props) {
  const { models } = useOpenRouterCatalogue()
  const selected = getOpenRouterModel(agentCli, args)

  const choose = (modelId: string | null) => onArgsChange(setOpenRouterModel(agentCli, args, modelId))

  const pill = (active: boolean): React.CSSProperties => ({
    background: active ? '#22c55e20' : '#ffffff08',
    border: active ? '1px solid #22c55e' : '1px solid #333',
    borderRadius: 4,
    padding: '3px 8px',
    color: active ? '#22c55e' : '#aaa',
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  // A model picked from search — or a pin OpenRouter has since withdrawn — still needs
  // to be visible and clearable, or it would be set with nothing in the UI showing it.
  const selectedIsPinned = selected !== null && PINNED_OPENROUTER_MODELS.some((p) => p.id === selected)

  return (
    <div>
      <label style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 5 }}>Model</label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        <button type="button" style={pill(selected === null)} onClick={() => choose(null)} title="Use the CLI's own configured default">
          Default
        </button>
        {PINNED_OPENROUTER_MODELS.map((p) => {
          const info = models.find((m) => m.id === p.id)
          return (
            <button
              key={p.id}
              type="button"
              style={pill(selected === p.id)}
              onClick={() => choose(p.id)}
              title={info ? `${p.id} — ${formatRate(info)}` : p.id}
            >
              {p.label}
            </button>
          )
        })}
        {selected !== null && !selectedIsPinned && (
          <button type="button" style={pill(true)} onClick={() => choose(null)} title={`${selected} — click to clear`}>
            {selected} ✕
          </button>
        )}
      </div>

      <OpenRouterModelSearch
        value={selected ?? ''}
        onChange={(id) => choose(id)}
        toolsOnly
      />
    </div>
  )
}
