import { useEffect, useState, useMemo } from 'react'

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
  phase: string
  goal: { goal: string } | null
  milestones: Milestone[]
  currentMilestoneId: string | null
  cycleCount: number
  costUsd: number
  costCapUsd: number
  lastDecisionText: string
  recentLog: ActivityEntry[]
  escalationReason: string | null
}

interface Props {
  terminalId: string
  onClose: () => void
}

export function AutopilotPanel({ terminalId, onClose }: Props) {
  const [state, setState] = useState<AutopilotState | null>(null)
  const [manualReply, setManualReply] = useState('')

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

  const isPaused = state.phase === 'paused'
  const isAwaitingReview = state.phase === 'awaiting_goal_review'
  const isEscalated = state.phase === 'escalated'

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
        Phase: <span style={{ color: '#ccc' }}>{state.phase}</span><br />
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

      {state.goal && (
        <div>
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>GOAL</div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>{state.goal.goal}</div>
        </div>
      )}

      <div>
        <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>MILESTONES</div>
        {state.milestones.map((m) => (
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
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>LAST ACTION</div>
          <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.lastDecisionText}
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
        {!isPaused && (
          <button onClick={() => window.api.autopilotPause(terminalId)} style={smallBtn}>⏸ Pause</button>
        )}
        {isPaused && (
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
