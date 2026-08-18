import { useCallback, useEffect, useMemo, useState } from 'react'

// Cross-session relay (CMDCLD-REQ-001 phase 1): send a pointer-only nudge to
// another session, see the queue, and read the relay log. Delivery is
// stage-only — the nudge lands in the target's composer without submitting.

interface RelayDialogProps {
  fromName: string
  fromTerminalId: string
  fromPath: string
  onClose: () => void
  onNotify: (message: string, kind?: 'info' | 'warn') => void
}

const STATUS_COLORS: Record<string, string> = {
  delivered: '#4ade80',
  queued: '#fbbf24',
  refused: '#ef4444',
  cancelled: '#888',
}

const inputStyle = {
  width: '100%',
  background: '#111122',
  border: '1px solid #333',
  borderRadius: '4px',
  color: '#e0e0e0',
  padding: '6px 8px',
  fontSize: '12px',
  boxSizing: 'border-box' as const,
}

const labelStyle = { color: '#888', fontSize: '11px', display: 'block', marginBottom: '4px' }

export function RelayDialog({ fromName, fromTerminalId, fromPath, onClose, onNotify }: RelayDialogProps) {
  // Sessions come from the main process so targets span every window.
  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([])
  const targets = useMemo(() => sessions.filter((s) => s.id !== fromTerminalId), [sessions, fromTerminalId])
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [path, setPath] = useState('')
  const [sending, setSending] = useState(false)
  const [state, setState] = useState<RelayState>({ queue: [], log: [], inbox: [] })
  const [adopted, setAdopted] = useState(true)
  const [logScope, setLogScope] = useState<'session' | 'all'>('session')

  useEffect(() => {
    let alive = true
    window.api.relaySessions().then((s) => { if (alive) setSessions(s) }).catch(() => {})
    window.api.relayState().then((s) => { if (alive) setState(s) }).catch(() => {})
    window.api.relayCheckAdoption(fromPath).then((a) => { if (alive) setAdopted(a) }).catch(() => {})
    const unsubscribe = window.api.onRelayUpdate((s) => setState(s))
    // Opening the dialog is "looking at the mail" — the envelope stops
    // flashing for this session.
    window.api.relayInboxMarkRead(fromTerminalId).catch(() => {})
    return () => { alive = false; unsubscribe() }
  }, [fromPath, fromTerminalId])


  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSend = useCallback(async () => {
    if (!to || !subject.trim() || !path.trim() || sending) return
    setSending(true)
    try {
      const res = await window.api.relaySend({ fromTerminalId, to, subject, path })
      if (res.status === 'delivered') {
        onNotify('Relay staged in target composer — submit happens there', 'info')
        setSubject('')
        setPath('')
      } else if (res.status === 'queued') {
        onNotify('Relay queued — will stage when the target is idle', 'info')
        setSubject('')
        setPath('')
      } else {
        onNotify(`Relay refused: ${res.error ?? 'unknown reason'}`, 'warn')
      }
    } catch {
      onNotify('Relay failed to send', 'warn')
    } finally {
      setSending(false)
    }
  }, [to, subject, path, sending, fromTerminalId, onNotify])

  // Per-session view (CMDCLD-REQ-001-response §5): this session's log is what
  // it sent (from-name match) plus what was delivered into it (terminalId).
  const recentLog = useMemo(() => {
    const relevant = logScope === 'all'
      ? state.log
      : state.log.filter((e) => e.terminalId === fromTerminalId || e.from === fromName)
    return [...relevant].reverse().slice(0, 25)
  }, [state.log, logScope, fromTerminalId, fromName])

  return (
    <div className="ui-scaled-plain" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#1a1a2e',
        borderRadius: '8px',
        padding: '20px',
        maxWidth: '560px',
        width: '90%',
        maxHeight: 'calc(85vh / var(--ui-scale-plain, 1))',
        overflowY: 'auto',
        border: '1px solid #333',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
          <span style={{ color: '#e0e0e0', fontWeight: 600 }}>Relay from “{fromName}”</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '13px' }}>&#10005;</button>
        </div>

        {!adopted && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px',
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: '6px', padding: '8px 10px',
          }}>
            <span style={{ color: '#fbbf24', fontSize: '12px', flex: 1 }}>
              This workspace hasn't adopted the exchange protocol (no docs\integration\).
            </span>
            <button
              onClick={() => {
                window.api.relayStageInvite(fromTerminalId).then((res) => {
                  if (res.ok) onNotify('Adoption invite staged in this session — review and press Enter', 'info')
                  else onNotify(res.error ?? 'Could not stage invite', 'warn')
                }).catch(() => onNotify('Could not stage invite', 'warn'))
              }}
              style={{ background: 'none', border: '1px solid rgba(251,191,36,0.5)', borderRadius: '4px', color: '#fbbf24', cursor: 'pointer', fontSize: '11px', padding: '3px 8px', flexShrink: 0 }}
            >
              Stage invite
            </button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>To session (open sessions suggested; a name that isn't open yet queues until it is)</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              list="relay-target-sessions"
              style={inputStyle}
              placeholder={targets.length > 0 ? targets[0].name : 'session name'}
            />
            <datalist id="relay-target-sessions">
              {targets.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Subject (one line)</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} style={inputStyle} placeholder="Protocol amendment: ack closes a thread" />
          </div>
          <div>
            <label style={labelStyle}>Document (must be under the sender repo's docs\integration\outbound\)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input value={path} onChange={(e) => setPath(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="D:\Source\...\docs\integration\outbound\XXX-REQ-001-....md" />
              <button
                onClick={() => {
                  window.api.relaySelectDocument(fromPath)
                    .then((picked) => { if (picked) setPath(picked) })
                    .catch(() => onNotify('Could not open the file picker', 'warn'))
                }}
                style={{
                  background: '#333', color: '#ccc', border: '1px solid #444',
                  borderRadius: '4px', padding: '6px 12px', cursor: 'pointer',
                  fontSize: '12px', flexShrink: 0,
                }}
              >
                Browse…
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSend}
              disabled={!to || !subject.trim() || !path.trim() || sending}
              style={{
                background: '#4f46e5', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '7px 16px', cursor: 'pointer', fontWeight: 600,
                opacity: !to || !subject.trim() || !path.trim() || sending ? 0.5 : 1,
              }}
            >
              {sending ? 'Sending…' : 'Stage relay'}
            </button>
          </div>
        </div>

        {state.inbox.some((n) => n.terminalId === fromTerminalId) && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Inbox ({state.inbox.filter((n) => n.terminalId === fromTerminalId).length})
            </div>
            {state.inbox.filter((n) => n.terminalId === fromTerminalId).map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #26263a', fontSize: '12px' }}>
                <span style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={n.path}>
                  <span style={{ color: '#a5b4fc' }}>{n.from}</span>: {n.subject}
                </span>
                <span style={{ color: '#666', flexShrink: 0, fontSize: '11px' }}>{new Date(n.ts).toLocaleTimeString()}</span>
                <button
                  onClick={() => {
                    window.api.relayInboxStage(n.id).then((res) => {
                      if (res.ok) { onNotify('Nudge staged in this session’s composer — press Enter there', 'info'); onClose() }
                      else onNotify(res.error ?? 'Could not stage the nudge', 'warn')
                    }).catch(() => onNotify('Could not stage the nudge', 'warn'))
                  }}
                  style={{ background: '#4f46e5', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                >
                  Stage
                </button>
                <button
                  onClick={() => { window.api.relayInboxDismiss(n.id).catch(() => {}) }}
                  style={{ background: 'none', border: '1px solid #444', borderRadius: '4px', color: '#888', cursor: 'pointer', fontSize: '11px', padding: '1px 6px', flexShrink: 0 }}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}

        {state.queue.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Queued ({state.queue.length})</div>
            {state.queue.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #26263a', fontSize: '12px' }}>
                <span style={{ color: '#fbbf24', flexShrink: 0 }}>{item.reason}</span>
                <span style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={item.path}>
                  {item.from} → {item.to}: {item.subject}
                </span>
                <button
                  onClick={() => { window.api.relayCancel(item.id).catch(() => {}) }}
                  style={{ background: 'none', border: '1px solid #444', borderRadius: '4px', color: '#888', cursor: 'pointer', fontSize: '11px', padding: '1px 6px', flexShrink: 0 }}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
            <span style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>Relay log</span>
            {(['session', 'all'] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setLogScope(scope)}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11px',
                  color: logScope === scope ? '#a5b4fc' : '#666',
                  textDecoration: logScope === scope ? 'underline' : 'none',
                }}
              >
                {scope === 'session' ? 'This session' : 'All sessions'}
              </button>
            ))}
          </div>
          {recentLog.length === 0 && (
            <span style={{ color: '#666', fontSize: '12px' }}>
              {logScope === 'session' ? 'No relays for this session yet' : 'No relays yet'}
            </span>
          )}
          {recentLog.map((entry) => (
            <div key={`${entry.id}-${entry.status}-${entry.ts}`} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '4px 0', borderBottom: '1px solid #26263a', fontSize: '12px' }}>
              <span style={{ color: STATUS_COLORS[entry.status] ?? '#ccc', flexShrink: 0, width: '64px' }}>{entry.status}</span>
              <span style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={`${entry.path}${entry.detail ? ` (${entry.detail})` : ''}`}>
                {entry.from} → {entry.to}: {entry.subject}
              </span>
              <span style={{ color: '#666', flexShrink: 0, fontSize: '11px' }}>
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
