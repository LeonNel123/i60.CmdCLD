import { useEffect, useState, useMemo } from 'react'
import { formatRelativeTime } from '../utils/format-relative-time'

interface Subgoal {
  id: string
  description: string
  status: 'pending' | 'partial' | 'done' | 'blocked'
}
interface Milestone {
  id: string
  name: string
  status: 'pending' | 'in-progress' | 'done' | 'blocked'
  subgoals: Subgoal[]
}
interface ActivityEntry {
  at: number
  kind: string
  summary: string
}
interface AutopilotState {
  phase?: string
  stage?: string
  control?: 'idle' | 'running' | 'paused' | 'blocked' | 'stopped'
  goal?: { goal: string } | null
  milestones?: Milestone[]
  currentMilestoneId?: string | null
  cycleCount: number
  costUsd: number
  costCapUsd: number
  lastDecisionText?: string
  recentLog: ActivityEntry[]
  escalationReason: string | null
  liveStatus: string | null
  lastMarker: { kind: string; subgoalId?: string; status?: string; receivedAt: number } | null
  permissionRequest: { text: string; detectedAt: number } | null
}
interface OutputInspection {
  rawChars: number
  cleanChars: number
  cleanTail: string
  marker: { kind: string; text?: string; question?: string; raw?: string } | null
  markerLine: string | null
  structuredFields: Record<string, string>
  summary: string
}
interface AttachDraft {
  classification: string
  bridgePrompt: string
  cleanTail: string
  usedLlm: boolean
  estimatedCostUsd?: number
  error?: string
}
interface AttachStatus {
  status: string
  message: string
  lastMarker?: { kind: string; receivedAt: number; text?: string } | null
}

interface Props {
  terminalId: string
  onClose: () => void
}

export function getAutopilotPanelControlFlags(state: {
  phase?: string
  control?: AutopilotState['control']
}) {
  const isPaused = state.phase === 'paused' || state.control === 'paused'
  const isAwaitingReview = state.phase === 'awaiting_goal_review'
  const isEscalated = state.phase === 'escalated' || state.control === 'blocked'
  const isStopped = state.phase === 'stopped' || state.control === 'stopped'
  const isCompleted = state.phase === 'completed'
  return {
    isPaused,
    isAwaitingReview,
    isEscalated,
    canPause: !isPaused && !isEscalated && !isStopped && !isCompleted,
    canResume: isPaused && !isEscalated && !isStopped,
  }
}

export function shouldAllowAttachDraft(state: AutopilotState | null): boolean {
  if (!state) return true
  const runStates = [state.phase, state.stage, state.control].filter((value): value is string => Boolean(value))
  if (runStates.length === 0) return false
  if (runStates.some((value) => value === 'executing' || value === 'running' || value === 'paused' || value === 'blocked')) {
    return false
  }
  return runStates.every((value) => value === 'idle' || value === 'stopped' || value === 'completed')
}

export function getAttachStatusLabel(status: AttachStatus | null): string {
  if (!status) return 'not attached'
  return `${status.status}: ${status.message}`
}

export function AutopilotPanel({ terminalId, onClose }: Props) {
  const [state, setState] = useState<AutopilotState | null>(null)
  const [manualReply, setManualReply] = useState('')
  const [actionExpanded, setActionExpanded] = useState(false)
  const [checkingOutput, setCheckingOutput] = useState(false)
  const [inspection, setInspection] = useState<OutputInspection | null>(null)
  const [inspectionError, setInspectionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (window.api.autopilotGetStatus(terminalId) as Promise<AutopilotState | null>).then((s) => {
      if (!cancelled) setState(s)
    })
    const off = window.api.onAutopilotUpdate((tId, s) => {
      if (tId === terminalId) setState(s as AutopilotState)
    })
    return () => { cancelled = true; off() }
  }, [terminalId])

  const pct = useMemo(() => {
    if (!state) return 0
    return state.costCapUsd > 0 ? (state.costUsd / state.costCapUsd) * 100 : 0
  }, [state])

  if (!state) return null

  const statusLabel = state.phase ?? state.stage ?? 'unknown'
  const statusKind = state.phase ? 'Phase' : 'Stage'
  const { isPaused, isAwaitingReview, isEscalated, canPause, canResume } = getAutopilotPanelControlFlags(state)
  const milestones = state.milestones ?? []
  const checkLatestOutput = async () => {
    setCheckingOutput(true)
    setInspectionError(null)
    try {
      const result = await window.api.autopilotInspectOutput(terminalId)
      setInspection(result as OutputInspection)
    } catch (e: any) {
      setInspectionError(e?.message ?? 'Failed to inspect output')
    } finally {
      setCheckingOutput(false)
    }
  }

  return (
    <div style={{
      width: 320, minWidth: 320, height: '100%',
      background: '#1a1a2e',
      borderLeft: '1px solid #2d2d2d',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'inherit', fontSize: 12, color: '#ccc',
      padding: 12, gap: 12, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>🤖 Autopilot</span>
        <button onClick={onClose} style={iconBtn}>×</button>
      </div>

      <div style={{ color: '#888', fontSize: 11, lineHeight: 1.5 }}>
        {statusKind}: <span style={{ color: '#ccc' }}>{statusLabel}</span>
        {state.control && <> · <span style={{ color: '#ccc' }}>{state.control}</span></>}<br />
        {state.liveStatus && (
          <>
            Status: <span style={{ color: '#a78bfa', fontStyle: 'italic' }}>{state.liveStatus}</span><br />
          </>
        )}
        Cycle {state.cycleCount}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888' }}>
          <span>Cost</span>
          <span style={{ color: pct >= 100 ? '#f87171' : pct >= 80 ? '#fbbf24' : '#888', fontFamily: 'monospace' }}>
            ${state.costUsd.toFixed(3)} / ${state.costCapUsd.toFixed(2)}
          </span>
        </div>
        <div style={{ height: 4, background: '#2d2d2d', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, pct)}%`,
            height: '100%',
            background: pct >= 100 ? '#f87171' : pct >= 80 ? '#fbbf24' : '#22c55e',
            transition: 'width 0.3s',
          }} />
        </div>
      </div>

      {state.permissionRequest && (
        <div style={{
          background: 'rgba(251,191,36,0.15)',
          border: '1px solid #fbbf24',
          borderRadius: 4,
          padding: 10,
          fontSize: 11,
          color: '#fbbf24',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Permission requested</div>
          <div style={{
            fontFamily: 'monospace',
            color: '#fde68a',
            marginBottom: 8,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {state.permissionRequest.text}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => window.api.autopilotPermissionAllow(terminalId)}
              style={{
                background: '#22c55e',
                border: 'none',
                color: '#000',
                cursor: 'pointer',
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 11,
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >Allow</button>
            <button
              onClick={() => window.api.autopilotPermissionDeny(terminalId)}
              style={{
                background: '#444',
                border: 'none',
                color: '#ccc',
                cursor: 'pointer',
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >Deny</button>
          </div>
        </div>
      )}

      {state.goal && (
        <div>
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>GOAL</div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>{state.goal.goal}</div>
        </div>
      )}

      <div>
        <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>MILESTONES</div>
        {milestones.map((m) => (
          <div key={m.id} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: m.id === state.currentMilestoneId ? '#a78bfa' : '#ccc' }}>
              {milestoneTick(m.status)} {m.id} — {m.name}
            </div>
            {m.id === state.currentMilestoneId && m.subgoals.map((s) => (
              <div key={s.id} style={{ paddingLeft: 16, fontSize: 11, color: '#aaa' }}>
                {subgoalTick(s.status)} {s.id}: {s.description}
              </div>
            ))}
          </div>
        ))}
      </div>

      {state.lastDecisionText && (
        <div>
          <div
            style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setActionExpanded((x) => !x)}
          >
            {actionExpanded ? '▾' : '▸'} LAST ACTION
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#aaa',
              fontFamily: 'monospace',
              overflow: actionExpanded ? 'visible' : 'hidden',
              textOverflow: actionExpanded ? 'unset' : 'ellipsis',
              whiteSpace: actionExpanded ? 'pre-wrap' : 'nowrap',
              wordBreak: 'break-word',
            }}
          >
            {state.lastDecisionText}
          </div>
        </div>
      )}

      {state.lastMarker && (
        <div>
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>LAST MARKER</div>
          <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>
            {state.lastMarker.kind}
            {state.lastMarker.subgoalId && ` ${state.lastMarker.subgoalId}`}
            {state.lastMarker.status && ` ${state.lastMarker.status}`}
            <span style={{ color: '#666' }}> · {formatRelativeTime(state.lastMarker.receivedAt)}</span>
          </div>
        </div>
      )}

      <div>
        <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>ACTIVITY</div>
        {state.recentLog.slice(-10).reverse().map((e, i) => (
          <div key={i} style={{ fontSize: 10, color: '#888', fontFamily: 'monospace', marginBottom: 2 }}>
            {e.kind}: {e.summary.slice(0, 60)}
          </div>
        ))}
      </div>

      <div>
        <button
          onClick={checkLatestOutput}
          disabled={checkingOutput}
          style={{ ...smallBtn, width: '100%' }}
        >
          {checkingOutput ? 'Checking...' : 'Check latest output'}
        </button>
        {inspectionError && (
          <div style={{ marginTop: 6, color: '#f87171', fontSize: 11 }}>{inspectionError}</div>
        )}
        {inspection && (
          <div style={{
            marginTop: 8,
            background: '#0d1117',
            border: '1px solid #2d2d2d',
            borderRadius: 4,
            padding: 8,
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#aaa',
          }}>
            <div style={{ color: inspection.marker ? '#86efac' : '#fbbf24', marginBottom: 6 }}>
              {inspection.summary}
            </div>
            <div style={{ color: '#666', marginBottom: 6 }}>
              {inspection.cleanChars} clean chars / {inspection.rawChars} raw chars
            </div>
            {Object.keys(inspection.structuredFields).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {Object.entries(inspection.structuredFields).slice(0, 8).map(([key, value]) => (
                  <div key={key}>
                    <span style={{ color: '#888' }}>{key}:</span> {value || '(empty)'}
                  </div>
                ))}
              </div>
            )}
            <pre style={{
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#777',
            }}>{inspection.cleanTail || '(empty scrollback)'}</pre>
          </div>
        )}
      </div>

      {isAwaitingReview && (
        <div style={{ background: 'rgba(167,139,250,0.08)', padding: 10, borderRadius: 4, fontSize: 11 }}>
          Goal files written to <code>.autopilot/</code>. Review and approve.
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button onClick={() => window.api.autopilotApproveGoal(terminalId)} style={primaryBtn}>Approve &amp; Start</button>
          </div>
        </div>
      )}

      {isEscalated && (
        <div style={{ background: 'rgba(248,113,113,0.08)', padding: 10, borderRadius: 4, fontSize: 11, color: '#f87171' }}>
          Escalated: {state.escalationReason}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        {canPause && (
          <button onClick={() => window.api.autopilotPause(terminalId)} style={smallBtn}>⏸ Pause</button>
        )}
        {canResume && (
          <button onClick={() => window.api.autopilotResume(terminalId)} style={smallBtn}>▶ Resume</button>
        )}
        <button onClick={() => { window.api.autopilotStop(terminalId); onClose() }} style={smallBtn}>⏹ Stop</button>
      </div>

      {(isPaused || isEscalated || isAwaitingReview) && (
        <div>
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>MANUAL REPLY</div>
          <textarea
            value={manualReply}
            onChange={(e) => setManualReply(e.target.value)}
            placeholder="Type a message to the doer..."
            style={{
              width: '100%', minHeight: 60, background: '#0d1117', border: '1px solid #2d2d2d',
              borderRadius: 4, padding: 8, color: '#ccc', fontSize: 11, fontFamily: 'monospace',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => {
              if (!manualReply.trim()) return
              window.api.autopilotReplyToWaiting(terminalId, manualReply)
              setManualReply('')
            }}
            style={{ ...primaryBtn, marginTop: 6 }}
          >Send</button>
        </div>
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, padding: '0 4px',
}
const smallBtn: React.CSSProperties = {
  background: '#333', border: 'none', color: '#ccc', cursor: 'pointer', borderRadius: 4,
  padding: '4px 10px', fontSize: 11, fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  background: '#a78bfa', border: 'none', color: '#000', cursor: 'pointer', borderRadius: 4,
  padding: '6px 12px', fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
}

function milestoneTick(s: string): string {
  switch (s) { case 'done': return '✓'; case 'in-progress': return '▶'; case 'blocked': return '!'; default: return '☐' }
}
function subgoalTick(s: string): string {
  switch (s) { case 'done': return '✓'; case 'partial': return '~'; case 'blocked': return '!'; default: return '☐' }
}
