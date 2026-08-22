import { useState, useEffect } from 'react'
import { AGENT_CLIS, AGENT_CLI_LABELS, getAutopilotRuntimeGuardrail, type AgentCli } from '../../../shared/agent-cli'

type AutopilotMode = 'classic' | 'pro' | 'council'
type CouncilIntensity = 'light' | 'balanced' | 'strict'

function firstOtherCli(cli: AgentCli): AgentCli {
  return AGENT_CLIS.find((candidate) => candidate !== cli) ?? 'claude'
}

interface Props {
  terminalId: string
  projectPath: string
  agentCli: AgentCli
  launchArgs: string
  defaultCostCap: number
  defaultMaxIterations: number
  onStarted: () => void
  onCancel: () => void
}

export function AutopilotKickoff({ terminalId, projectPath, agentCli, launchArgs, defaultCostCap, defaultMaxIterations, onStarted, onCancel }: Props) {
  const [idea, setIdea] = useState('')
  const [costCap, setCostCap] = useState(defaultCostCap)
  const [maxIter, setMaxIter] = useState(defaultMaxIterations)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<AutopilotMode>('classic')
  const [showModeHelp, setShowModeHelp] = useState(false)
  const [reviewerCli, setReviewerCli] = useState<AgentCli>(firstOtherCli(agentCli))
  const [intensity, setIntensity] = useState<CouncilIntensity>('balanced')
  const [artifacts, setArtifacts] = useState<{ hasClassic: boolean; hasPro: boolean; hasCouncil: boolean }>({
    hasClassic: false,
    hasPro: false,
    hasCouncil: false,
  })
  const guardrail = getAutopilotRuntimeGuardrail(agentCli, launchArgs)

  useEffect(() => {
    setReviewerCli(firstOtherCli(agentCli))
  }, [agentCli])

  useEffect(() => {
    let cancelled = false
    void window.api.autopilotProbeArtifacts(projectPath).then((result) => {
      if (!cancelled) setArtifacts(result)
    })
    return () => { cancelled = true }
  }, [projectPath])

  const start = async () => {
    if (!idea.trim() || !guardrail.canStart) return
    setBusy(true); setError(null)
    const res = mode === 'council'
      ? await window.api.autopilotCouncilStart({
          terminalId,
          projectPath,
          freeTextIdea: idea,
          costCapUsd: costCap,
          implementerCli: agentCli,
          reviewerCli,
          intensity,
        })
      : mode === 'pro'
        ? await window.api.autopilotProStart({
            terminalId, projectPath, freeTextIdea: idea, costCapUsd: costCap,
          })
        : await window.api.autopilotStart({
            terminalId, projectPath, freeTextIdea: idea, costCapUsd: costCap, maxIterations: maxIter,
          })
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'failed'); return }
    onStarted()
  }

  const resume = async () => {
    if (!guardrail.canStart) return
    setBusy(true); setError(null)
    const res = mode === 'council'
      ? await window.api.autopilotCouncilStart({
          terminalId,
          projectPath,
          freeTextIdea: '',
          costCapUsd: costCap,
          implementerCli: agentCli,
          reviewerCli,
          intensity,
        })
      : mode === 'pro'
        ? await window.api.autopilotProStart({
            terminalId, projectPath, freeTextIdea: '', costCapUsd: costCap,
          })
        : await window.api.autopilotStart({
            terminalId, projectPath, freeTextIdea: '', costCapUsd: costCap, maxIterations: maxIter,
          })
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'failed'); return }
    onStarted()
  }

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid rgba(167,139,250,0.4)',
      borderRadius: 8,
      padding: 20,
      margin: 12,
      fontFamily: 'inherit', fontSize: 13, color: '#ccc',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ color: '#a78bfa', fontWeight: 600 }}>🤖 Start Autopilot</div>
      <div style={{
        background: guardrail.canStart ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.1)',
        border: `1px solid ${guardrail.canStart ? 'rgba(34,197,94,0.45)' : 'rgba(248,113,113,0.55)'}`,
        borderRadius: 4,
        padding: 10,
        color: guardrail.canStart ? '#86efac' : '#fca5a5',
        fontSize: 11,
        lineHeight: 1.4,
      }}>
        <div style={{ fontWeight: 600, marginBottom: guardrail.reason || guardrail.warnings.length ? 4 : 0 }}>
          Runtime: {AGENT_CLI_LABELS[agentCli]}
        </div>
        {guardrail.reason && <div>{guardrail.reason}</div>}
        {guardrail.warnings.map((warning, i) => <div key={i}>{warning}</div>)}
        {guardrail.canStart && agentCli === 'codex' && !guardrail.warnings.length && (
          <div>Codex sandboxed full auto is enabled for this terminal.</div>
        )}
      </div>
      {((mode === 'classic' && artifacts.hasClassic) || (mode === 'pro' && artifacts.hasPro) || (mode === 'council' && artifacts.hasCouncil)) && (
        <>
          <button
            onClick={resume}
            disabled={busy || !guardrail.canStart}
            style={{
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid #22c55e',
              color: '#22c55e',
              padding: '8px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 600,
              opacity: busy || !guardrail.canStart ? 0.5 : 1,
            }}
          >▶ Resume existing run</button>
          <div style={{ color: '#666', fontSize: 11, textAlign: 'center', margin: '4px 0' }}>── or start fresh ──</div>
        </>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#888' }}>Mode:</span>
        {(['classic', 'pro', 'council'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              background: mode === m ? '#a78bfa20' : '#ffffff05',
              border: mode === m ? '1px solid #a78bfa' : '1px solid #2d2d2d',
              color: mode === m ? '#a78bfa' : '#888',
              padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {m === 'classic' ? 'Classic' : m === 'pro' ? 'PRO (beta)' : 'Council'}
          </button>
        ))}
        <span style={{ color: '#666', fontSize: 10, marginLeft: 6 }}>
          {mode === 'council'
            ? 'One CLI implements; the other reviews at structured gates'
            : mode === 'pro'
              ? 'Discovery → planning → impl → review with structured gates'
              : 'Drive a single goal with milestones (v1.2.4 default)'}
        </span>
        <button
          onClick={() => setShowModeHelp((v) => !v)}
          aria-expanded={showModeHelp}
          title="What the three modes do differently"
          style={{
            background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 10, padding: '2px 4px', marginLeft: 'auto',
            textDecoration: 'underline',
          }}
        >{showModeHelp ? 'Hide guide' : "Which should I use?"}</button>
      </div>
      {showModeHelp && (
        <div style={{
          background: '#111827',
          border: '1px solid #2d2d2d',
          borderRadius: 4,
          padding: 12,
          fontSize: 11,
          lineHeight: 1.55,
          color: '#aaa',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div>
            All three drive the CLI agent in this terminal towards a goal, replying to it each time
            it stops. They differ in how much structure they impose before code gets written, and in
            how many agents are involved.
          </div>

          <div>
            <div style={{ color: '#e0e0e0', fontWeight: 600 }}>Classic — one goal, milestone by milestone</div>
            You describe a goal; the agent breaks it into milestones and works through them, checking
            in as it finishes each one. Nothing is written down first, so it starts fastest and leaves
            the least behind. Best when you already know what needs doing and it fits in one sitting.
            State lives in <code style={{ color: '#a78bfa' }}>.autopilot/</code>.
          </div>

          <div>
            <div style={{ color: '#e0e0e0', fontWeight: 600 }}>PRO — spec first, then plan, then code</div>
            Runs as stages: discovery → planning → implementation → review of each phase → final
            review. It writes a spec and a phased plan and waits for those to be approved before any
            code is written, so you can read and correct the intent before it becomes a diff. Slower
            to start and it makes more planner calls, which cost more. Best for work you want a
            record of, or where getting the approach wrong is expensive. State and artifacts live in
            <code style={{ color: '#a78bfa' }}> .autopilot-pro/</code> — spec.md and plan.md are worth
            reading while it runs.
          </div>

          <div>
            <div style={{ color: '#e0e0e0', fontWeight: 600 }}>Council — one agent writes, another reviews</div>
            Uses two CLI sessions: an implementer and a separate reviewer that inspects the work at
            fixed gates and can send it back. Costs roughly twice as much and takes longer, and you
            need a second agent available. Best when a second opinion is worth more than speed.
            Intensity sets how readily the reviewer blocks. State lives in
            <code style={{ color: '#a78bfa' }}> .autopilot-council/</code>.
          </div>

          <div style={{ borderTop: '1px solid #2d2d2d', paddingTop: 8 }}>
            <div style={{ color: '#e0e0e0', fontWeight: 600 }}>True of all three</div>
            You can pause, resume or stop from the panel at any time, and reply by hand when the run
            asks a question. A run stops itself if it hits the cost cap, if the agent goes silent, or
            if it gets stuck — the panel then shows why, and that state is one-way: read what
            happened, then stop and start again. Your files are only ever changed by the agent
            itself, so <code style={{ color: '#a78bfa' }}>git status</code> and
            <code style={{ color: '#a78bfa' }}> git diff</code> stay the honest record of what a run
            did. Picking a mode you have run before offers to resume it instead of starting over.
          </div>
        </div>
      )}
      {mode === 'council' && (
        <div style={{
          background: '#111827',
          border: '1px solid #2d2d2d',
          borderRadius: 4,
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>COUNCIL</div>
          <div style={{ fontSize: 11, color: '#aaa' }}>
            Implementer: <span style={{ color: '#ccc' }}>{AGENT_CLI_LABELS[agentCli]}</span> · Reviewer:{' '}
            <select
              value={reviewerCli}
              onChange={(e) => setReviewerCli(e.target.value as AgentCli)}
              style={{ background: '#0d1117', color: '#ccc', border: '1px solid #2d2d2d', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontFamily: 'inherit' }}
            >
              {AGENT_CLIS.filter((cli) => cli !== agentCli).map((cli) => (
                <option key={cli} value={cli}>{AGENT_CLI_LABELS[cli]}</option>
              ))}
            </select>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: '#aaa' }}>
            Intensity
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value as CouncilIntensity)}
              style={{ width: 140, background: '#0d1117', color: '#ccc', border: '1px solid #2d2d2d', borderRadius: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
            >
              <option value="light">Light</option>
              <option value="balanced">Balanced</option>
              <option value="strict">Strict</option>
            </select>
          </label>
          <div style={{ color: '#777', fontSize: 10 }}>
            Implementer wins non-high-risk disagreements. High-risk Reviewer findings pause for user decision.
          </div>
        </div>
      )}
      <textarea
        autoFocus
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe what you want to build..."
        style={{
          width: '100%', minHeight: 200, background: '#0d1117', border: '1px solid #2d2d2d',
          borderRadius: 4, padding: 12, color: '#ccc', fontSize: 13, fontFamily: 'inherit',
          resize: 'vertical', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Cost cap (USD)
          <input type="number" step="0.1" min="0.1" value={costCap} onChange={(e) => setCostCap(Number(e.target.value) || 1)}
            style={{ width: 80, background: '#0d1117', border: '1px solid #2d2d2d', borderRadius: 4, padding: '4px 8px', color: '#ccc', fontSize: 12, fontFamily: 'monospace' }} />
        </label>
        {mode === 'classic' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            Max iterations
            <input type="number" min="1" value={maxIter} onChange={(e) => setMaxIter(Number(e.target.value) || 40)}
              style={{ width: 80, background: '#0d1117', border: '1px solid #2d2d2d', borderRadius: 4, padding: '4px 8px', color: '#ccc', fontSize: 12, fontFamily: 'monospace' }} />
          </label>
        )}
      </div>
      {error && <div style={{ color: '#f87171', fontSize: 11 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={busy}
          style={{ background: '#333', border: 'none', color: '#ccc', cursor: 'pointer', borderRadius: 4, padding: '6px 12px', fontSize: 11, fontFamily: 'inherit' }}>
          Cancel
        </button>
        <button onClick={start} disabled={busy || !idea.trim() || !guardrail.canStart}
          style={{ background: '#a78bfa', border: 'none', color: '#000', cursor: 'pointer', borderRadius: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', opacity: busy || !idea.trim() || !guardrail.canStart ? 0.5 : 1 }}>
          {busy ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  )
}
