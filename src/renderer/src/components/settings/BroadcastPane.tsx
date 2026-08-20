import { BROADCAST_REFINE_SYSTEM_PROMPT } from '../../../../shared/broadcast'
import { Field, MONO_FONT, PaneHeading, PillGroup, TextInput } from './controls'

export interface BroadcastPaneProps {
  autoRefine: boolean
  onAutoRefineChange: (v: boolean) => void
  refineModel: string
  onRefineModelChange: (v: string) => void
  /** Empty means the shipped default is in use. */
  systemPrompt: string
  onSystemPromptChange: (v: string) => void
}

// Measured 2026-08-19 against the real refine prompt with reasoning off: median of 3
// runs, end to end including network. Cost is per refine call at the observed token
// counts (~840 in / ~65 out).
const REFINE_PICKS = [
  { id: 'nvidia/nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning', speed: '1.08s · $0.08/1k', star: true, hint: 'fastest measured, faithful rewrites' },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', speed: '1.29s · $0.03/1k', star: false, hint: 'cheapest; fastest first token (0.50s)' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', speed: '1.38s · $0.24/1k', star: false, hint: 'best quality - preserves hedging and nuance' },
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', speed: '1.56s · $0.34/1k', star: false, hint: 'fast, but blurred a detail in testing' },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash', speed: '~1.7s · $0.14/1k', star: false, hint: 'latest dated flash; faithful and tight' },
  { id: 'z-ai/glm-4.7-flash', label: 'GLM 4.7 Flash', speed: '1.80s · $0.07/1k', star: false, hint: 'cheapest of the GLM line' },
  { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash', speed: '~6s · $0.60/1k', star: false, hint: 'capable but slow here - reasoning cannot be disabled' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', speed: '1.61s · $3.83/1k', star: false, hint: 'fast but 48x the flash tier for a rewrite' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (Anthropic)', speed: 'n/a · $1/$5 per M', star: false, hint: 'stay on Anthropic - uses that key' },
] as const

export function BroadcastPane(p: BroadcastPaneProps) {
  // Blank means "use the shipped prompt", which is what keeps an untouched install
  // tracking improvements to it. The editor shows the default so it can be read and
  // edited, but only a real change is stored.
  const shown = p.systemPrompt.trim() ? p.systemPrompt : BROADCAST_REFINE_SYSTEM_PROMPT
  const isCustom = p.systemPrompt.trim().length > 0
    && p.systemPrompt.trim() !== BROADCAST_REFINE_SYSTEM_PROMPT.trim()

  return (
    <>
      <PaneHeading>Broadcast</PaneHeading>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, fontSize: 12, color: '#ccc', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={p.autoRefine}
          onChange={(e) => p.onAutoRefineChange(e.target.checked)}
          style={{ accentColor: '#22c55e', marginTop: 2 }}
        />
        <span>
          Auto-refine broadcasts
          <div style={{ color: '#666', fontSize: 10, marginTop: 2, lineHeight: 1.5 }}>
            Send rewrites the prompt and dispatches it in one press. The message is not
            recallable once sent — the bar keeps your original so you can restore and
            resend it, and Send as is skips the rewrite for a single message.
          </div>
        </span>
      </label>

      <Field label="Refine model">
        <TextInput
          value={p.refineModel}
          onChange={(e) => p.onRefineModelChange(e.target.value)}
          placeholder="blank = use the Autopilot planner model"
        />
        <div style={{ color: '#666', fontSize: 10, marginTop: 6, marginBottom: 4, lineHeight: 1.5 }}>
          A one-shot rewrite, so a small fast model is the right tool — the planner model
          is for orchestration. Times are median end-to-end on the real refine prompt with
          reasoning off.
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

      <Field label="Refine system prompt">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: isCustom ? '#fbbf24' : '#666' }}>
            {isCustom ? 'Customised — the default is no longer tracked' : 'Using the shipped default'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => p.onSystemPromptChange('')}
            disabled={!isCustom}
            title="Discard your edits and go back to the prompt CmdCLD ships with"
            style={{
              border: '1px solid #444', borderRadius: 4, padding: '3px 9px', fontSize: 10,
              background: '#ffffff08', color: isCustom ? '#fbbf24' : '#555',
              borderColor: isCustom ? '#fbbf2455' : '#333',
              cursor: isCustom ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
            }}
          >
            ↩ Revert to default
          </button>
        </div>
        <textarea
          value={shown}
          onChange={(e) => {
            const v = e.target.value
            // Storing blank when it matches the default keeps this install on the shipped
            // prompt rather than pinning a copy that never gets improvements.
            p.onSystemPromptChange(v.trim() === BROADCAST_REFINE_SYSTEM_PROMPT.trim() ? '' : v)
          }}
          spellCheck={false}
          rows={26}
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: 420, resize: 'vertical',
            background: '#0d1117', border: '1px solid #333', borderRadius: 4,
            padding: '10px 12px', color: '#e0e0e0', fontSize: 11,
            fontFamily: MONO_FONT, lineHeight: 1.55, outline: 'none',
          }}
        />
        <div style={{ color: '#666', fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
          Sent as the system message on every refine. The prompt you type is appended
          separately, fenced between markers, so it is treated as material to edit rather
          than instructions. Changes take effect on the next refine — nothing to restart.
        </div>
      </Field>
    </>
  )
}
