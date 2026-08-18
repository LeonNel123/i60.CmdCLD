import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { X } from './icons'
import { selectBroadcastTargets } from '../../../shared/broadcast'

interface BroadcastBarProps {
  terminals: Array<{ id: string; name: string; agentCli?: string; isPlainShell?: boolean }>
  onClose: () => void
}

type SendResult = { id: string; ok: boolean; error?: string }

const MONO = 'Menlo, Consolas, monospace'

const buttonBase: CSSProperties = {
  border: '1px solid #444', borderRadius: '4px', padding: '5px 12px',
  fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
}

/**
 * Bottom-docked composer that sends one prompt to several agent consoles at
 * once, with an optional AI rewrite first. Selection defaults to every open
 * agent console and reconciles as consoles open and close.
 */
export function BroadcastBar({ terminals, onClose }: BroadcastBarProps) {
  const targets = useMemo(() => selectBroadcastTargets(terminals), [terminals])

  const [draft, setDraft] = useState('')
  // The pre-refine text, so a rewrite can be undone.
  const [rawBackup, setRawBackup] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(targets.map((t) => t.id)))
  const [refining, setRefining] = useState(false)
  const [sending, setSending] = useState(false)
  const [refineAvailable, setRefineAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SendResult[] | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const knownIdsRef = useRef<Set<string>>(new Set(targets.map((t) => t.id)))

  // Refine needs an API key for the Autopilot provider; the key itself never
  // reaches the renderer, only its existence.
  useEffect(() => {
    let cancelled = false
    window.api.settingsGetAll()
      .then((s) => window.api.autopilotKeyExists(s.autopilotApiProvider ?? 'anthropic'))
      .then((exists) => { if (!cancelled) setRefineAvailable(exists) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Keep the selection in step with the console list: drop closed consoles,
  // auto-select ones opened while the bar is up.
  useEffect(() => {
    const currentIds = new Set(targets.map((t) => t.id))
    setSelected((prev) => {
      const next = new Set<string>()
      for (const id of currentIds) {
        if (prev.has(id) || !knownIdsRef.current.has(id)) next.add(id)
      }
      return next
    })
    knownIdsRef.current = currentIds
  }, [targets])

  const toggleTarget = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleDraftChange = (value: string) => {
    setDraft(value)
    setResults(null)
    setError(null)
  }

  const handleRefine = async () => {
    const raw = draft.trim()
    if (!raw || refining) return
    setRefining(true)
    setError(null)
    setResults(null)
    try {
      const labels = targets.filter((t) => selected.has(t.id)).map((t) => t.label)
      const res = await window.api.broadcastRefine({ text: raw, targetLabels: labels })
      if (res.ok && res.text) {
        setRawBackup(draft)
        setDraft(res.text)
      } else {
        setError(res.error ?? 'Refine failed.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefining(false)
      textareaRef.current?.focus()
    }
  }

  const handleUndo = () => {
    if (rawBackup === null) return
    setDraft(rawBackup)
    setRawBackup(null)
    setResults(null)
    textareaRef.current?.focus()
  }

  const handleSend = async () => {
    const text = draft.trim()
    const ids = targets.filter((t) => selected.has(t.id)).map((t) => t.id)
    if (!text || ids.length === 0 || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await window.api.broadcastSend({ terminalIds: ids, text })
      setResults(res.results)
      if (res.ok) {
        setDraft('')
        setRawBackup(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const selectedCount = targets.filter((t) => selected.has(t.id)).length
  const canSend = !sending && draft.trim().length > 0 && selectedCount > 0
  const canRefine = refineAvailable && !refining && draft.trim().length > 0
  const labelFor = (id: string) => targets.find((t) => t.id === id)?.label ?? id

  return (
    <div style={{
      flexShrink: 0,
      background: '#1a1a2e',
      borderTop: '1px solid #2a2a3a',
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      fontFamily: 'inherit',
      fontSize: '12px',
      color: '#ccc',
    }}>
      {/* Row 1: title + target chips + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '12px', marginRight: '4px' }}>Broadcast</span>
        {targets.length === 0 && (
          <span style={{ color: '#666', fontSize: '11px' }}>No agent consoles open</span>
        )}
        {targets.map((t) => {
          const on = selected.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => toggleTarget(t.id)}
              title={on ? 'Click to exclude from this send' : 'Click to include in this send'}
              style={{
                ...buttonBase,
                padding: '3px 9px',
                background: on ? '#22c55e20' : '#ffffff08',
                border: on ? '1px solid #22c55e' : '1px solid #333',
                color: on ? '#22c55e' : '#888',
              }}
            >
              {on ? '✓ ' : ''}{t.label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close broadcast bar (Esc)"
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
        >
          <X width={14} height={14} />
        </button>
      </div>

      {/* Row 2: composer + actions */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        <textarea
          ref={textareaRef}
          autoFocus
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={(e) => {
            const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
            if (mod && e.key === 'Enter') { e.preventDefault(); void handleSend() }
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
          rows={3}
          spellCheck={false}
          placeholder="Describe what all agents should do… (Ctrl+Enter to send)"
          disabled={refining}
          style={{
            flex: 1,
            resize: 'vertical',
            minHeight: '56px',
            background: '#0d1117',
            border: '1px solid #333',
            borderRadius: '4px',
            padding: '8px 10px',
            color: '#e0e0e0',
            fontSize: '12px',
            fontFamily: MONO,
            outline: 'none',
            opacity: refining ? 0.6 : 1,
            lineHeight: 1.45,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, justifyContent: 'flex-start' }}>
          <button
            onClick={() => { void handleRefine() }}
            disabled={!canRefine}
            title={
              !refineAvailable
                ? 'Set an API key in Settings → Autopilot to enable AI refine'
                : 'Rewrite this into a clear, technically precise prompt'
            }
            style={{
              ...buttonBase,
              background: '#ffffff08',
              color: canRefine ? '#e0e0e0' : '#666',
              cursor: canRefine ? 'pointer' : 'not-allowed',
              opacity: canRefine ? 1 : 0.6,
            }}
          >
            {refining ? 'Refining…' : '✨ Refine'}
          </button>
          {rawBackup !== null && (
            <button
              onClick={handleUndo}
              title="Restore the text you typed before refining"
              style={{ ...buttonBase, background: '#ffffff08', color: '#ccc' }}
            >
              Undo
            </button>
          )}
          <button
            onClick={() => { void handleSend() }}
            disabled={!canSend}
            title={selectedCount === 0 ? 'Select at least one console' : 'Send to the selected consoles (Ctrl+Enter)'}
            style={{
              ...buttonBase,
              background: canSend ? '#22c55e' : '#166534',
              border: 'none',
              color: canSend ? '#000' : '#9a9',
              fontWeight: 600,
              cursor: canSend ? 'pointer' : 'not-allowed',
            }}
          >
            {sending ? 'Sending…' : `Send to ${selectedCount}`}
          </button>
        </div>
      </div>

      {/* Row 3: feedback */}
      {(error || results) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minHeight: '18px' }}>
          {error && <span style={{ color: '#ef4444', fontSize: '11px' }}>{error}</span>}
          {results?.map((r) => (
            <span
              key={r.id}
              title={r.error}
              style={{
                fontSize: '10px',
                padding: '2px 7px',
                borderRadius: '3px',
                background: r.ok ? '#22c55e14' : '#ef444414',
                color: r.ok ? '#22c55e' : '#ef4444',
                border: `1px solid ${r.ok ? '#22c55e40' : '#ef444440'}`,
              }}
            >
              {r.ok ? '✓' : '✗'} {labelFor(r.id)}{r.ok ? '' : ` — ${r.error ?? 'failed'}`}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
