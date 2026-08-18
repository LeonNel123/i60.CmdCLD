import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Cross-session relay: compose an ask for another session (the document is
// authored into the domain hub, pushed, and a pointer nudge is relayed), read
// this session's inbox, and inspect the queue/log. Delivery is inbox-first;
// only staging into a composer happens on an explicit click.

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
const sectionHeading = { color: '#888', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }

export function RelayDialog({ fromName, fromTerminalId, fromPath, onClose, onNotify }: RelayDialogProps) {
  // Sessions come from the main process so targets span every window.
  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([])
  const [suggestions, setSuggestions] = useState<{ machines: string[]; pastTargets: string[] }>({ machines: [], pastTargets: [] })
  const targets = useMemo(() => sessions.filter((s) => s.id !== fromTerminalId), [sessions, fromTerminalId])
  // Datalist entries: live sessions, every target used before, and the
  // name@MACHINE cross-product of known session names × hub machines — so
  // typing "Sec" also offers "Security@WORKBOX"-style completions.
  const targetOptions = useMemo(() => {
    const names = new Set<string>(targets.map((t) => t.name))
    for (const t of suggestions.pastTargets) names.add(t.replace(/@[^@]*$/, ''))
    const options = new Set<string>([...targets.map((t) => t.name), ...suggestions.pastTargets])
    for (const name of names) {
      for (const machine of suggestions.machines) options.add(`${name}@${machine}`)
    }
    return [...options].slice(0, 60)
  }, [targets, suggestions])
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [hubClones, setHubClones] = useState<string[]>([])
  const [hubClone, setHubClone] = useState('')
  const [existingMode, setExistingMode] = useState(false)
  const [path, setPath] = useState('')
  const [sending, setSending] = useState(false)
  const [state, setState] = useState<RelayState>({ queue: [], log: [], inbox: [] })
  const [adopted, setAdopted] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [logScope, setLogScope] = useState<'session' | 'all'>('session')
  // A flashing envelope means the human came to READ, not to write: with
  // nudges waiting, the dialog opens inbox-first and compose is a click away.
  const [composeOpen, setComposeOpen] = useState(true)
  const composeInitRef = useRef(false)

  // Drag (header) + native resize (CSS). Centered until first drag.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    const onMove = (ev: MouseEvent): void => {
      if (!dragRef.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - dragRef.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dragRef.current.dy)),
      })
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    let alive = true
    window.api.relaySessions().then((s) => { if (alive) setSessions(s) }).catch(() => {})
    window.api.relayTargetSuggestions().then((s) => { if (alive) setSuggestions(s) }).catch(() => {})
    window.api.relayState().then((s) => {
      if (!alive) return
      setState(s)
      if (!composeInitRef.current) {
        composeInitRef.current = true
        if (s.inbox.some((n) => n.terminalId === fromTerminalId)) setComposeOpen(false)
      }
    }).catch(() => {})
    window.api.relayCheckAdoption(fromPath).then((a) => { if (alive) setAdopted(a) }).catch(() => {})
    window.api.settingsGetAll().then((s) => {
      if (!alive) return
      const clones = s.relayHubClones ?? []
      setHubClones(clones)
      if (clones.length > 0) setHubClone(clones[0])
      if (clones.length === 0) setExistingMode(true)
    }).catch(() => {})
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

  const composeReady = !!to && !!subject.trim() && !!body.trim() && !!hubClone && !sending
  const handleCompose = useCallback(async () => {
    if (!composeReady) return
    setSending(true)
    try {
      const res = await window.api.relayCompose({ fromTerminalId, to, subject, body, hubClone })
      if (res.ok) {
        onNotify(`Committed ${res.fileName} to the hub — nudge ${res.sendStatus === 'queued' ? 'queued' : 'delivered'}`, 'info')
        onClose()
      } else {
        onNotify(`Compose failed: ${res.error ?? 'unknown reason'}`, 'warn')
      }
    } catch {
      onNotify('Compose failed', 'warn')
    } finally {
      setSending(false)
    }
  }, [composeReady, fromTerminalId, to, subject, body, hubClone, onNotify, onClose])

  const handleSendExisting = useCallback(async () => {
    if (!to || !subject.trim() || !path.trim() || sending) return
    setSending(true)
    try {
      const res = await window.api.relaySend({ fromTerminalId, to, subject, path })
      if (res.status === 'delivered') {
        onNotify('Nudge delivered to the target inbox', 'info')
        onClose()
      } else if (res.status === 'queued') {
        onNotify('Nudge queued — delivers when the target resolves', 'info')
        onClose()
      } else {
        onNotify(`Relay refused: ${res.error ?? 'unknown reason'}`, 'warn')
      }
    } catch {
      onNotify('Relay failed to send', 'warn')
    } finally {
      setSending(false)
    }
  }, [to, subject, path, sending, fromTerminalId, onNotify, onClose])

  // Per-session view: this session's log is what it sent (from-name match)
  // plus what was delivered into it (terminalId).
  const recentLog = useMemo(() => {
    const relevant = logScope === 'all'
      ? state.log
      : state.log.filter((e) => e.terminalId === fromTerminalId || e.from === fromName)
    return [...relevant].reverse().slice(0, 25)
  }, [state.log, logScope, fromTerminalId, fromName])

  const inboxItems = useMemo(
    () => state.inbox.filter((n) => n.terminalId === fromTerminalId),
    [state.inbox, fromTerminalId],
  )

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
      <div
        ref={boxRef}
        style={{
          background: '#1a1a2e',
          borderRadius: '8px',
          border: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          // Sized relative to the app window; user-resizable from the corner.
          width: 'min(72vw, 860px)',
          height: 'min(78vh, 820px)',
          minWidth: '480px',
          minHeight: '360px',
          maxWidth: '96vw',
          maxHeight: '94vh',
          resize: 'both',
          overflow: 'hidden',
          ...(pos ? { position: 'fixed' as const, left: pos.x, top: pos.y, margin: 0 } : {}),
        }}
      >
        {/* Header: drag handle */}
        <div
          onMouseDown={onHeaderMouseDown}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '14px 20px 10px', cursor: 'move', userSelect: 'none', flexShrink: 0,
            borderBottom: '1px solid #26263a',
          }}
        >
          <span style={{ color: '#e0e0e0', fontWeight: 600 }}>Relay from “{fromName}”</span>
          <button onClick={onClose} onMouseDown={(e) => e.stopPropagation()} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '13px' }}>&#10005;</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 20px' }}>

        {!adopted && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px',
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: '6px', padding: '8px 10px',
          }}>
            <span style={{ color: '#fbbf24', fontSize: '12px', flex: 1 }}>
              This workspace hasn't adopted the exchange protocol.
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

        {inboxItems.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={sectionHeading}>Inbox ({inboxItems.length})</div>
            {inboxItems.map((n) => (
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

        {/* Compose — collapsed when the dialog was opened for waiting nudges */}
        {!composeOpen && (
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={() => setComposeOpen(true)}
              style={{ background: 'none', border: '1px dashed #444', borderRadius: '6px', color: '#888', cursor: 'pointer', fontSize: '12px', padding: '6px 12px', width: '100%' }}
            >
              + Compose an ask
            </button>
          </div>
        )}
        {composeOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>To project/session — the name is the key, wherever it runs (@MACHINE only to pin one machine)</label>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                list="relay-target-sessions"
                style={inputStyle}
                placeholder={targets.length > 0 ? targets[0].name : 'session name'}
              />
              <datalist id="relay-target-sessions">
                {targetOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            {!existingMode && hubClones.length > 1 && (
              <div style={{ width: '40%' }}>
                <label style={labelStyle}>Hub (where the document is authored)</label>
                <select value={hubClone} onChange={(e) => setHubClone(e.target.value)} style={{ ...inputStyle, padding: '6px' }}>
                  {hubClones.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Subject (one line — becomes the thread slug and the nudge)</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} style={inputStyle} placeholder="request: add a health endpoint for the deploy probe" />
          </div>

          {!existingMode ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={labelStyle}>Your ask — written into the hub as the thread document</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  style={{ ...inputStyle, minHeight: '160px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                  placeholder={'What you need, and the contract/interface — not how the other project should implement it.'}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end' }}>
                {hubClones.length === 0 && (
                  <span style={{ color: '#fbbf24', fontSize: '11px', flex: 1 }}>
                    No hub clones configured — add one in Settings → Exchange to compose.
                  </span>
                )}
                <button
                  onClick={() => setExistingMode(true)}
                  style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                >
                  reference an existing document instead
                </button>
                <button
                  onClick={handleCompose}
                  disabled={!composeReady}
                  style={{
                    background: '#4f46e5', color: '#fff', border: 'none',
                    borderRadius: '6px', padding: '7px 16px', cursor: 'pointer', fontWeight: 600,
                    opacity: composeReady ? 1 : 0.5,
                  }}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label style={labelStyle}>Document (in a hub outbound/ or a repo's docs\integration\outbound\)</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input value={path} onChange={(e) => setPath(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="path to an existing exchange document" />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end' }}>
                {hubClones.length > 0 && (
                  <button
                    onClick={() => setExistingMode(false)}
                    style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                  >
                    compose a new ask instead
                  </button>
                )}
                <button
                  onClick={handleSendExisting}
                  disabled={!to || !subject.trim() || !path.trim() || sending}
                  style={{
                    background: '#4f46e5', color: '#fff', border: 'none',
                    borderRadius: '6px', padding: '7px 16px', cursor: 'pointer', fontWeight: 600,
                    opacity: !to || !subject.trim() || !path.trim() || sending ? 0.5 : 1,
                  }}
                >
                  {sending ? 'Sending…' : 'Send nudge'}
                </button>
              </div>
            </>
          )}
        </div>
        )}

        {/* Only this session's own sends — the queue is outgoing mail waiting
            for its target, and reads as incoming if shown unscoped. */}
        {state.queue.filter((q) => q.from === fromName).length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={sectionHeading}>Outgoing — waiting for target ({state.queue.filter((q) => q.from === fromName).length})</div>
            {state.queue.filter((q) => q.from === fromName).map((item) => (
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

        {/* History — collapsed by default; the working surfaces above are the
            point of the dialog, the audit trail is on request. */}
        <div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11px', color: '#666', textDecoration: 'underline' }}
          >
            {showHistory ? 'hide history' : 'show history'}
          </button>
          {showHistory && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
                <span style={{ ...sectionHeading, marginBottom: 0, flex: 1 }}>Relay log</span>
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
          )}
        </div>

        </div>
      </div>
    </div>
  )
}
