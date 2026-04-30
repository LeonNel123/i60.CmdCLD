import { useState } from 'react'

interface Props {
  terminalId: string
  projectPath: string
  defaultCostCap: number
  defaultMaxIterations: number
  onStarted: () => void
  onCancel: () => void
}

export function AutopilotKickoff({ terminalId, projectPath, defaultCostCap, defaultMaxIterations, onStarted, onCancel }: Props) {
  const [idea, setIdea] = useState('')
  const [costCap, setCostCap] = useState(defaultCostCap)
  const [maxIter, setMaxIter] = useState(defaultMaxIterations)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'classic' | 'pro'>('classic')

  const start = async () => {
    if (!idea.trim()) return
    setBusy(true); setError(null)
    const res = mode === 'pro'
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

  return (
    <div style={{
      background: 'rgba(167,139,250,0.08)',
      border: '1px solid rgba(167,139,250,0.3)',
      borderRadius: 6,
      padding: 12,
      margin: 8,
      fontFamily: 'inherit', fontSize: 12, color: '#ccc',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ color: '#a78bfa', fontWeight: 600 }}>🤖 Start Autopilot</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#888' }}>Mode:</span>
        {(['classic', 'pro'] as const).map((m) => (
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
            {m === 'classic' ? 'Classic' : 'PRO (beta)'}
          </button>
        ))}
        <span style={{ color: '#666', fontSize: 10, marginLeft: 6 }}>
          {mode === 'pro'
            ? 'Discovery → planning → impl → review with structured gates'
            : 'Drive a single goal with milestones (v1.2.4 default)'}
        </span>
      </div>
      <textarea
        autoFocus
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe what you want to build..."
        style={{
          width: '100%', minHeight: 80, background: '#0d1117', border: '1px solid #2d2d2d',
          borderRadius: 4, padding: 8, color: '#ccc', fontSize: 12, fontFamily: 'inherit',
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
          style={{ background: '#333', border: 'none', color: '#ccc', cursor: 'pointer', borderRadius: 4, padding: '6px 12px', fontSize: 11 }}>
          Cancel
        </button>
        <button onClick={start} disabled={busy || !idea.trim()}
          style={{ background: '#a78bfa', border: 'none', color: '#000', cursor: 'pointer', borderRadius: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600, opacity: busy || !idea.trim() ? 0.5 : 1 }}>
          {busy ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  )
}
