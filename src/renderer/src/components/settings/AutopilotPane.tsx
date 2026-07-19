import { useEffect, useState } from 'react'
import { Field, INPUT_STYLE, MONO_FONT, PaneHeading, PillGroup, TextInput } from './controls'

export interface AutopilotPaneProps {
  provider: 'anthropic' | 'openrouter'
  onProviderChange: (p: 'anthropic' | 'openrouter') => void
  model: string
  onModelChange: (v: string) => void
  costCap: number
  onCostCapChange: (v: number) => void
  maxIter: number
  onMaxIterChange: (v: number) => void
  activeProjectPath?: string
}

interface BudgetState {
  date: string
  perProject: Record<string, { spentUsd: number; capUsd: number }>
  global: { spentUsd: number; capUsd: number }
}

const MODEL_PICKS = {
  anthropic: [
    { id: 'claude-haiku-4-5',           label: 'Haiku 4.5',        cost: '$1 / $5',        star: true,  hint: 'fast & cheap, premium JSON' },
    { id: 'claude-sonnet-5',            label: 'Sonnet 5',         cost: '$3 / $15',       star: false, hint: 'balanced default' },
    { id: 'claude-opus-4-8',            label: 'Opus 4.8',         cost: '$5 / $25',       star: false, hint: 'most capable Opus' },
    { id: 'claude-fable-5',             label: 'Fable 5',          cost: '$10 / $50',      star: false, hint: 'top capability, pricey for orchestration' },
  ],
  openrouter: [
    { id: 'moonshotai/kimi-k2-0905',    label: 'Kimi K2 0905',     cost: '$0.40 / $2.00',  star: true,  hint: 'best value, agentic, 262K ctx' },
    { id: 'moonshotai/kimi-k2.6',       label: 'Kimi K2.6',        cost: '$0.75 / $3.50',  star: false, hint: 'newer flagship, multimodal' },
    { id: 'google/gemini-2.5-flash',    label: 'Gemini 2.5 Flash', cost: '$0.30 / $2.50',  star: false, hint: 'cheap & very fast' },
    { id: 'google/gemini-2.5-pro',      label: 'Gemini 2.5 Pro',   cost: '$1.25 / $10',    star: false, hint: 'premium reasoning' },
    { id: 'openai/gpt-5-mini',          label: 'GPT-5 mini',       cost: '$0.25 / $2.00',  star: false, hint: 'cheap OpenAI value pick' },
    { id: 'openai/gpt-5',               label: 'GPT-5',            cost: '$1.25 / $10',    star: false, hint: 'premium OpenAI' },
    { id: 'deepseek/deepseek-v3.2-exp', label: 'DeepSeek V3.2',    cost: '$0.27 / $1.10',  star: false, hint: 'very cheap, strong reasoning' },
    { id: 'qwen/qwen3-coder',           label: 'Qwen3 Coder',      cost: '$0.20 / $0.80',  star: false, hint: 'cheapest, agentic-tuned' },
    { id: 'x-ai/grok-4',                label: 'Grok 4',           cost: '$3 / $15',       star: false, hint: 'xAI premium' },
  ],
} as const

const SMALL_NUMBER_INPUT: React.CSSProperties = {
  ...INPUT_STYLE, width: '100px', padding: '4px 8px', color: '#ccc', fontFamily: MONO_FONT,
}

export function AutopilotPane(p: AutopilotPaneProps) {
  const [hasAnthKey, setHasAnthKey] = useState(false)
  const [hasORKey, setHasORKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  const [budgetState, setBudgetState] = useState<BudgetState | null>(null)
  const [projectCap, setProjectCap] = useState(5)
  const [globalCap, setGlobalCap] = useState(20)
  const [projectSpent, setProjectSpent] = useState(0)
  const [globalSpent, setGlobalSpent] = useState(0)

  useEffect(() => {
    Promise.all([
      window.api.autopilotKeyExists('anthropic'),
      window.api.autopilotKeyExists('openrouter'),
    ]).then(([a, o]) => { setHasAnthKey(a); setHasORKey(o) })
  }, [])

  const applyBudget = (data: {
    state: BudgetState | null
    snapshot: { projectCap: number; globalCap: number; projectSpent: number; globalSpent: number }
  }) => {
    setBudgetState(data.state)
    setProjectCap(data.snapshot.projectCap)
    setGlobalCap(data.snapshot.globalCap)
    setProjectSpent(data.snapshot.projectSpent)
    setGlobalSpent(data.snapshot.globalSpent)
  }

  useEffect(() => {
    void window.api.settingsGetBudgetState(p.activeProjectPath ?? '').then(applyBudget).catch(() => {})
  }, [p.activeProjectPath])

  const refreshBudget = async () => {
    const data = await window.api.settingsGetBudgetState(p.activeProjectPath ?? '')
    applyBudget(data)
  }

  const hasKey = p.provider === 'anthropic' ? hasAnthKey : hasORKey
  const setHasKey = p.provider === 'anthropic' ? setHasAnthKey : setHasORKey

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <PaneHeading>Autopilot</PaneHeading>

      <Field label="API Provider">
        <PillGroup
          value={p.provider}
          onChange={p.onProviderChange}
          options={(['anthropic', 'openrouter'] as const).map((pr) => ({ value: pr, label: pr }))}
        />
      </Field>

      <Field label={`API Key (${p.provider})`}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <TextInput
            mono
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey ? '•••••••• (set)' : 'Paste key'}
            style={{ flex: 1, width: undefined, padding: '6px 10px' }}
          />
          <button
            onClick={async () => {
              if (keyInput.trim()) {
                await window.api.autopilotKeySet(p.provider, keyInput.trim())
                setKeyInput('')
                setHasKey(true)
              }
            }}
            style={{ background: '#22c55e', border: 'none', color: '#000', borderRadius: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >Save Key</button>
          <button
            onClick={async () => {
              await window.api.autopilotKeyClear(p.provider)
              setHasKey(false)
            }}
            style={{ background: '#333', border: 'none', color: '#ccc', borderRadius: 4, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}
          >Clear</button>
        </div>
      </Field>

      <Field label="Planner Model">
        <TextInput
          mono
          value={p.model}
          onChange={(e) => p.onModelChange(e.target.value)}
          style={{ padding: '6px 10px' }}
        />
        <div style={{ color: '#666', fontSize: 10, marginTop: 6, marginBottom: 4 }}>
          Quick picks for {p.provider} (click to fill — ★ = recommended):
        </div>
        <PillGroup
          small
          value={p.model}
          onChange={p.onModelChange}
          options={MODEL_PICKS[p.provider].map((m) => ({
            value: m.id,
            title: m.hint,
            label: (
              <>
                {m.star && <span style={{ color: '#fbbf24', marginRight: 3 }}>★</span>}
                {m.label} <span style={{ color: '#555' }}>{m.cost}</span>
              </>
            ),
          }))}
        />
      </Field>

      <div style={{ display: 'flex', gap: 12, marginBottom: '16px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#888' }}>
          Default cost cap (USD)
          <input type="number" step="0.1" min="0.1" value={p.costCap}
            onChange={(e) => p.onCostCapChange(Number(e.target.value) || 1)}
            style={SMALL_NUMBER_INPUT}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#888' }}>
          Default max iterations
          <input type="number" min="1" value={p.maxIter}
            onChange={(e) => p.onMaxIterChange(Number(e.target.value) || 40)}
            style={SMALL_NUMBER_INPUT}
          />
        </label>
      </div>

      {budgetState && (
        <div style={{ paddingTop: 14, borderTop: '1px solid #2a2a2a' }}>
          <h4 style={{ color: '#e0e0e0', margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>Daily cost budget</h4>
          <div style={{ color: '#666', fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
            Hard pauses Autopilot runs when reached; warns at 80%. Resets at midnight (local).
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#888' }}>
              Per-project (USD/day)
              <input
                type="number" step="0.5" min="0" value={projectCap}
                disabled={!p.activeProjectPath}
                onChange={(e) => setProjectCap(Number(e.target.value) || 0)}
                onBlur={() => {
                  if (p.activeProjectPath) {
                    void window.api.settingsSetBudgetCap('project', p.activeProjectPath, projectCap).then(() => refreshBudget())
                  }
                }}
                style={{ ...SMALL_NUMBER_INPUT, opacity: p.activeProjectPath ? 1 : 0.5 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#888' }}>
              Global (USD/day)
              <input
                type="number" step="1" min="0" value={globalCap}
                onChange={(e) => setGlobalCap(Number(e.target.value) || 0)}
                onBlur={() => {
                  void window.api.settingsSetBudgetCap('global', null, globalCap).then(() => refreshBudget())
                }}
                style={SMALL_NUMBER_INPUT}
              />
            </label>
          </div>
          {!p.activeProjectPath && (
            <div style={{ color: '#666', fontSize: 10, marginTop: 6 }}>
              Open a terminal to configure per-project caps.
            </div>
          )}
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
            Spent today — project: ${projectSpent.toFixed(3)} / ${projectCap.toFixed(2)} · global: ${globalSpent.toFixed(3)} / ${globalCap.toFixed(2)}
          </div>
          <button
            onClick={async () => {
              await window.api.settingsResetTodaySpend()
              await refreshBudget()
            }}
            style={{
              background: '#ffffff08', border: '1px solid #333', borderRadius: 4,
              padding: '4px 10px', color: '#888', fontSize: 11, fontFamily: 'inherit',
              cursor: 'pointer', marginTop: 8,
            }}
          >
            Reset today's spend
          </button>
        </div>
      )}
    </div>
  )
}
