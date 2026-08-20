import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { X } from './icons'
import { reconcileSelection, selectBroadcastTargets, selectionUnchanged } from '../../../shared/broadcast'

interface BroadcastBarProps {
  terminals: Array<{ id: string; name: string; agentCli?: string; isPlainShell?: boolean; folderPath?: string }>
  onOpenHistory?: () => void
  /**
   * Console selection, held by the parent so it survives the bar being closed and
   * reopened. `known` carries the ids the bar has already seen: without it, every
   * console would look newly-opened on remount and be auto-selected, which would undo
   * the memory. Session-only by design — nothing is persisted to disk.
   */
  selection?: { selected: string[]; known: string[] } | null
  onSelectionChange?: (v: { selected: string[]; known: string[] }) => void
  /**
   * Seeded from history replay. Carries a counter because replaying the same prompt
   * twice produces an identical string, which on its own would not re-fire the effect.
   */
  seed?: { text: string; n: number } | null
  onClose: () => void
}

type SendResult = { id: string; ok: boolean; error?: string }

const MONO = 'Menlo, Consolas, monospace'

const COMPOSER_MIN_HEIGHT = 104
/** Ceiling as a share of the window, so a long dictation never swallows the grid. */
const COMPOSER_MAX_VIEWPORT_FRACTION = 0.34

const buttonBase: CSSProperties = {
  border: '1px solid #444', borderRadius: '4px', padding: '5px 12px',
  fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
}

/**
 * Bottom-docked composer that sends one prompt to several agent consoles at
 * once, with an optional AI rewrite first. Selection defaults to every open
 * agent console and reconciles as consoles open and close.
 */
export function BroadcastBar({ terminals, onClose, onOpenHistory, seed, selection, onSelectionChange }: BroadcastBarProps) {
  const targets = useMemo(() => selectBroadcastTargets(terminals), [terminals])

  const [draft, setDraft] = useState('')
  // The pre-refine text, so a rewrite can be undone.
  const [rawBackup, setRawBackup] = useState<string | null>(null)
  // Auto-refine sends the rewrite straight through. The text the author typed is kept
  // so the composer can restore it afterwards — the send itself is not undoable.
  const [autoRefine, setAutoRefine] = useState(false)
  // What actually went out, so the composer can clear for the next prompt while the
  // send stays visible and recoverable below it.
  const [lastSent, setLastSent] = useState<{ sent: string; original: string; at: number } | null>(null)
  // Restored from the parent when reopening; first open selects everything.
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(selection ? selection.selected : targets.map((t) => t.id)))
  const [refining, setRefining] = useState(false)
  const [sending, setSending] = useState(false)
  const [refineAvailable, setRefineAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SendResult[] | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const knownIdsRef = useRef<Set<string>>(
    new Set(selection ? selection.known : targets.map((t) => t.id)))

  // Refine needs an API key for the Autopilot provider; the key itself never
  // reaches the renderer, only its existence.
  useEffect(() => {
    let cancelled = false
    window.api.settingsGetAll().then((st) => { if (!cancelled) setAutoRefine(!!st.broadcastAutoRefine) }).catch(() => {})
    window.api.settingsGetAll()
      .then((s) => window.api.autopilotKeyExists(s.autopilotApiProvider ?? 'anthropic'))
      .then((exists) => { if (!cancelled) setRefineAvailable(exists) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Grow the composer to fit its content, between the floor and the viewport ceiling.
  // Runs before paint so a pasted or dictated block never flashes at the old height.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const ceiling = Math.round(window.innerHeight * COMPOSER_MAX_VIEWPORT_FRACTION)
    el.style.height = 'auto'
    // Clamp order matters: the ceiling wins over the floor, so a short window keeps its grid.
    el.style.height = `${Math.min(Math.max(COMPOSER_MIN_HEIGHT, el.scrollHeight), ceiling)}px`
  }, [draft])

  // Keep the selection in step with the console list: drop closed consoles,
  // auto-select ones opened while the bar is up.
  useEffect(() => {
    const currentIds = targets.map((t) => t.id)
    setSelected((prev) => {
      const next = reconcileSelection(currentIds, prev, knownIdsRef.current)
      // Returning `prev` unchanged makes React bail out. Handing back a fresh Set with
      // identical contents would re-render, and with anything upstream churning the
      // targets identity that becomes a loop rather than a wasted render.
      if (selectionUnchanged(prev, next)) return prev
      return new Set(next)
    })
    knownIdsRef.current = new Set(currentIds)
  }, [targets])

  // Push every selection change up so it outlives this component. Runs after the
  // reconcile above, so what the parent stores already excludes closed consoles.
  //
  // Guarded against re-sending an identical payload: the parent stores this in state, so
  // an unconditional push re-renders the parent, which can feed straight back here. The
  // guard makes that terminate regardless of what upstream does with identities.
  const lastPushedRef = useRef('')
  useEffect(() => {
    const payload = { selected: [...selected], known: [...knownIdsRef.current] }
    const key = JSON.stringify(payload)
    if (key === lastPushedRef.current) return
    lastPushedRef.current = key
    onSelectionChange?.(payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, targets])

  const toggleTarget = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (!seed || !seed.text) return
    setDraft(seed.text)
    setRawBackup(null)
    textareaRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n])

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

  // `refine` false forces a raw send even when auto-refine is on — the "Send as is"
  // escape hatch for a prompt that is already exactly as intended.
  const handleSend = async (refine = autoRefine) => {
    const text = draft.trim()
    const chosen = targets.filter((t) => selected.has(t.id))
    const ids = chosen.map((t) => t.id)
    if (!text || ids.length === 0 || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await window.api.broadcastSend({
        terminalIds: ids,
        text,
        autoRefine: refine,
        targetLabels: chosen.map((t) => t.label),
        projects: chosen.map((t) => t.folderPath).filter((p): p is string => !!p),
        // An explicit Refine press already replaced the composer text; pass what was
        // typed so history stores the pair rather than calling the rewrite the original.
        originalText: rawBackup ?? undefined,
      })
      setResults(res.results)
      // Surfaced rather than swallowed: the message still went, just unrewritten.
      if (res.refineError) setError(`Sent without refining — ${res.refineError}`)
      if (res.ok) {
        // Clear for the next prompt. What went out is not lost — it moves to the
        // last-sent strip below, where it can be reused or reverted.
        setLastSent({ original: res.originalText ?? text, sent: res.sentText ?? text, at: Date.now() })
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

  // Puts text from the last send back in the composer. The send already happened; this
  // only repopulates the box so it can be corrected and sent again.
  const restoreToComposer = (text: string) => {
    setDraft(text)
    setResults(null)
    textareaRef.current?.focus()
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
        <label
          title={refineAvailable
            ? 'Rewrite every broadcast through the AI automatically, then send it'
            : 'Set an API key in Settings → Autopilot to enable AI refine'}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
            color: autoRefine ? '#22c55e' : '#888', cursor: refineAvailable ? 'pointer' : 'not-allowed' }}
        >
          <input
            type="checkbox"
            checked={autoRefine}
            disabled={!refineAvailable}
            onChange={(e) => {
              setAutoRefine(e.target.checked)
              void window.api.settingsSet('broadcastAutoRefine', e.target.checked)
            }}
            style={{ accentColor: '#22c55e', margin: 0 }}
          />
          Auto-refine
        </label>
        {onOpenHistory && (
          <button onClick={onOpenHistory} title="Prompt history"
            style={{ ...buttonBase, padding: '3px 8px', background: '#ffffff08', color: '#888' }}>
            History
          </button>
        )}
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
          rows={5}
          spellCheck={false}
          placeholder="Describe what all agents should do — type or dictate, rough is fine… (Ctrl+Enter to send)"
          disabled={refining}
          style={{
            flex: 1,
            resize: 'vertical',
            maxHeight: `${COMPOSER_MAX_VIEWPORT_FRACTION * 100}vh`,
            overflowY: 'auto',
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

          {autoRefine && (
            <button
              onClick={() => { void handleSend(false) }}
              disabled={!canSend}
              title="Send exactly what is in the composer, skipping the rewrite"
              style={{ ...buttonBase, background: '#ffffff08', color: canSend ? '#ccc' : '#666', cursor: canSend ? 'pointer' : 'not-allowed' }}
            >
              Send as is
            </button>
          )}
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
            {sending ? (autoRefine ? 'Refining & sending…' : 'Sending…') : `${autoRefine ? '✨ ' : ''}Send to ${selectedCount}`}
          </button>
        </div>
      </div>

      {/* Row 3: what went out last. Keeps the send visible after the composer clears,
          and is the only place the original is recoverable once auto-refine replaced it. */}
      {lastSent && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, paddingTop: 5,
          borderTop: '1px solid #2a2a3a', fontSize: 10, color: '#666', minWidth: 0,
        }}>
          <span style={{ flexShrink: 0, color: '#555' }}>
            Last sent {new Date(lastSent.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span
            title={lastSent.sent}
            style={{
              flex: 1, minWidth: 0, color: '#8a8a8a', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: MONO,
            }}
          >
            {lastSent.sent.replace(/\s+/g, ' ')}
          </span>
          <button
            onClick={() => restoreToComposer(lastSent.sent)}
            title="Put this text back in the composer to send again"
            style={{ ...buttonBase, padding: '2px 7px', fontSize: 10, background: '#ffffff08', color: '#999' }}
          >
            Reuse
          </button>
          {lastSent.sent !== lastSent.original && (
            <button
              onClick={() => restoreToComposer(lastSent.original)}
              title="Put back what you typed before the rewrite. The message already went out — this does not recall it."
              style={{ ...buttonBase, padding: '2px 7px', fontSize: 10, background: '#ffffff08', color: '#fbbf24', borderColor: '#fbbf2455' }}
            >
              ↩ Revert
            </button>
          )}
        </div>
      )}

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
