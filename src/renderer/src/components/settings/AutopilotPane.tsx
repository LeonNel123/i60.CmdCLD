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
  refineModel: string
  autoRefine: boolean
  onAutoRefineChange: (v: boolean) => void
  onRefineModelChange: (v: string) => void
  activeProjectPath?: string
}

interface BudgetState {
  date: string
  perProject: Record<string, { spentUsd: number; capUsd: number }>
  global: { spentUsd: number; capUsd: number }
}

// Measured 2026-08-19 against the real refine system prompt with reasoning disabled:
// median of 3 runs, end-to-end including network. Cost is per refine call at the
// observed token counts (~840 in / ~65 out).
const REFINE_PICKS = [
  { id: 'nvidia/nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning', speed: '1.08s · $0.08/1k', star: true,  hint: 'fastest measured, faithful rewrites' },
  { id: 'qwen/qwen3.7-flash',            label: 'Qwen3.7 Flash',          speed: '1.29s · $0.03/1k', star: false, hint: 'cheapest; fastest first token (0.50s)' },
  { id: 'openai/gpt-5.6-luna',           label: 'GPT-5.6 Luna',           speed: '1.38s · $0.24/1k', star: false, hint: 'best quality - preserves hedging and nuance' },
  { id: 'google/gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite',  speed: '1.56s · $0.34/1k', star: false, hint: 'fast, but blurred a detail in testing' },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash',    speed: '~1.7s · $0.14/1k', star: false, hint: 'latest dated flash; faithful and tight' },
  { id: 'z-ai/glm-4.7-flash',            label: 'GLM 4.7 Flash',          speed: '1.80s · $0.07/1k', star: false, hint: 'cheapest of the GLM line' },
  { id: 'google/gemini-3.7-flash',       label: 'Gemini 3.7 Flash',       speed: '~6s · $0.60/1k',   star: false, hint: 'capable but slow here - reasoning cannot be disabled' },
  { id: 'moonshotai/kimi-k3',            label: 'Kimi K3',                speed: '1.61s · $3.83/1k', star: false, hint: 'fast but 48x the flash tier for a rewrite' },
  { id: 'claude-haiku-4-5',              label: 'Haiku 4.5 (Anthropic)',  speed: 'n/a · $1/$5 per M', star: false, hint: 'stay on Anthropic - uses that key' },
] as const

const MODEL_PICKS = {
  anthropic: [
    { id: 'claude-haiku-4-5',           label: 'Haiku 4.5',        cost: '$1 / $5',        star: true,  hint: 'fast & cheap, premium JSON' },
    { id: 'claude-sonnet-5',            label: 'Sonnet 5',         cost: '$3 / $15',       star: false, hint: 'balanced default' },
    { id: 'claude-opus-4-8',            label: 'Opus 4.8',         cost: '$5 / $25',       star: false, hint: 'most capable Opus' },
    { id: 'claude-fable-5',             label: 'Fable 5',          cost: '$10 / $50',      star: false, hint: 'top capability, pricey for orchestration' },
  ],
  openrouter: [
    // ★ = measured on real planner decisions (see REFINE_PICKS note for the method).
    // Entries without a score have not been benchmarked; prices are live as of 2026-08-20.
    { id: 'openai/gpt-5.6-luna',           label: 'GPT-5.6 Luna',      cost: '$0.20 / $1.20',  star: true,  hint: 'benchmarked 6/6 correct, fastest (0.48s) - best planner' },
    { id: 'openai/gpt-5.6-luna-pro',       label: 'GPT-5.6 Luna Pro',  cost: '$0.20 / $1.20',  star: false, hint: 'same price as Luna, pro variant' },
    { id: 'openai/gpt-5.6-terra',          label: 'GPT-5.6 Terra',     cost: '$2.00 / $12.00', star: false, hint: 'mid tier of the 5.6 family' },
    { id: 'openai/gpt-5.6-terra-pro',      label: 'GPT-5.6 Terra Pro', cost: '$2.00 / $12.00', star: false, hint: 'mid tier, pro variant' },
    { id: 'openai/gpt-5.6-sol',            label: 'GPT-5.6 Sol',       cost: '$2.50 / $15.00', star: false, hint: 'top of the 5.6 family' },
    { id: 'openai/gpt-5.6-sol-pro',        label: 'GPT-5.6 Sol Pro',   cost: '$2.50 / $15.00', star: false, hint: 'top tier, pro variant' },
    { id: 'qwen/qwen3.7-plus',             label: 'Qwen3.7 Plus',      cost: '$0.32 / $1.28',  star: true,  hint: 'benchmarked 6/6 correct, 0.76s - best value planner' },
    { id: 'qwen/qwen3.8-max',              label: 'Qwen3.8 Max',       cost: '$2.00 / $6.00',  star: false, hint: 'newest Qwen flagship' },
    { id: 'qwen/qwen3.8-27b',              label: 'Qwen3.8 27B',       cost: '$0.45 / $3.20',  star: false, hint: 'newest Qwen, smaller and cheaper' },
    { id: 'qwen/qwen3.8-2.4t-a95b',        label: 'Qwen3.8 2.4T',      cost: '$2.00 / $6.00',  star: false, hint: 'newest Qwen, largest MoE' },
    { id: 'deepseek/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro',   cost: '$1.19 / $3.56',  star: false, hint: 'benchmarked 6/6 correct, 1.3s (repriced 2026-08-20)' },
    { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash', cost: '$0.14 / $0.28', star: false, hint: 'latest dated flash; cheap, better at refine than planning' },
    { id: 'google/gemini-3.7-flash',       label: 'Gemini 3.7 Flash',  cost: '$0.38 / $1.88',  star: false, hint: 'benchmarked 6/6 correct but 2.5s; reasoning cannot be disabled' },
    { id: 'z-ai/glm-5.3',                  label: 'GLM 5.3',           cost: '$1.40 / $4.40',  star: false, hint: 'benchmarked 6/6 correct, slowest tested (2.9s)' },
    { id: 'z-ai/glm-5.2',                  label: 'GLM 5.2',           cost: '$0.97 / $3.04',  star: false, hint: 'previous GLM flagship, cheaper than 5.3' },
    { id: 'moonshotai/kimi-k3',            label: 'Kimi K3',           cost: '$3.00 / $15.00', star: false, hint: 'benchmarked 5/6; conservative about declaring done' },
    { id: 'x-ai/grok-4.6',                 label: 'Grok 4.6',          cost: '$2.00 / $6.00',  star: false, hint: 'xAI premium (not benchmarked)' },
    // Deliberately NOT listed for planning: nvidia/nemotron-3.5-lightning is the fastest
    // refine model but scored 3/6 here and, on a repeated blocker, told the doer to retry
    // what had already failed three times - which loops a run indefinitely.
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
          Quick picks for {p.provider} (click to fill — ★ = recommended). OpenRouter entries
          were scored on real planner decisions: valid JSON, correct decision, speed, cost.
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

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 12, color: '#ccc', cursor: 'pointer' }}>
        <input type="checkbox" checked={p.autoRefine}
          onChange={(e) => p.onAutoRefineChange(e.target.checked)}
          style={{ accentColor: '#22c55e' }} />
        <span>
          Auto-refine broadcasts
          <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
            Send rewrites the prompt and dispatches it in one press. The message is not
            recallable once sent — the composer keeps your original so you can restore and
            resend it, and Send as is skips the rewrite for a single message.
          </div>
        </span>
      </label>

      <Field label="Broadcast refine model">
        <TextInput
          value={p.refineModel}
          onChange={(e) => p.onRefineModelChange(e.target.value)}
          placeholder="blank = use the planner model above"
        />
        <div style={{ color: '#666', fontSize: 10, marginTop: 6, marginBottom: 4 }}>
          Used only by Broadcast → Refine. A one-shot rewrite, so a small fast model is
          the right tool — the planner model is for orchestration. Times below are median
          end-to-end on the real refine prompt, reasoning off.
        </div>
        <PillGroup
          small
          value={p.refineModel}
          onChange={p.onRefineModelChange}
          options={REFINE_PICKS.map((m) => ({
            value: m.id,
            title: m.hint,
            label: (
              <>
                {m.star && <span style={{ color: '#fbbf24', marginRight: 3 }}>★</span>}
                {m.label} <span style={{ color: '#555' }}>{m.speed}</span>
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
