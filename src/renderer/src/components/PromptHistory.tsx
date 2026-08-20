import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { X } from './icons'
import type { PromptRecord } from '../types/api'

interface PromptHistoryProps {
  onClose: () => void
  /** Load this text into the broadcast composer and close. */
  onReplay: (text: string) => void
}

const MONO = 'Menlo, Consolas, monospace'

const btn: CSSProperties = {
  border: '1px solid #444', borderRadius: 4, padding: '4px 10px',
  fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  background: '#ffffff08', color: '#ccc',
}

function when(ts: number): string {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const day = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  return sameDay ? time : day + ' ' + time
}

/**
 * Broadcast prompt history. Every send is recorded with what was typed and what was
 * actually dispatched, so a rewrite can be inspected after the fact and any prompt can
 * be put back into the composer — including against a different set of projects.
 */
export function PromptHistory({ onClose, onReplay }: PromptHistoryProps) {
  const [rows, setRows] = useState<PromptRecord[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    window.api.promptsList({ limit: 200 })
      .then((r) => { setRows(r); setSelectedId((cur) => cur ?? (r[0]?.id ?? null)) })
      .catch(() => setRows([]))
  }
  useEffect(load, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.originalText.toLowerCase().includes(q)
      || (r.refinedText ?? '').toLowerCase().includes(q)
      || r.targets.join(' ').toLowerCase().includes(q))
  }, [rows, query])

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null

  const remove = async (id: number): Promise<void> => {
    setBusy(true)
    try { await window.api.promptsDelete(id); setSelectedId(null); load() } finally { setBusy(false) }
  }

  const clearAll = async (): Promise<void> => {
    if (!confirm('Delete the entire prompt history? This cannot be undone.')) return
    setBusy(true)
    try { await window.api.promptsClear(); setSelectedId(null); load() } finally { setBusy(false) }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#00000088', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ui-scaled-plain"
        style={{
          width: 'min(1100px, 92vw)', height: 'min(680px, 88vh)',
          background: '#1e1e1e', border: '1px solid #2d2d2d', borderRadius: 6,
          display: 'flex', flexDirection: 'column', color: '#ccc', fontSize: 12,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #2d2d2d', background: '#252526' }}>
          <span style={{ fontWeight: 600, color: '#e0e0e0' }}>Prompt history</span>
          <span style={{ color: '#666', fontSize: 11 }}>
            {rows ? rows.length + (rows.length === 1 ? ' broadcast' : ' broadcasts') : 'loading…'}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{ marginLeft: 8, flex: 1, maxWidth: 260, background: '#0d1117', border: '1px solid #333', borderRadius: 4, padding: '4px 8px', color: '#e0e0e0', fontSize: 11, outline: 'none' }}
          />
          <div style={{ flex: 1 }} />
          <button onClick={clearAll} disabled={busy || !rows?.length} style={{ ...btn, color: '#ef4444', borderColor: '#ef444455' }}>Clear all</button>
          <button onClick={onClose} title="Close (Esc)" style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex' }}>
            <X width={14} height={14} />
          </button>
        </header>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: 320, borderRight: '1px solid #2d2d2d', overflowY: 'auto' }}>
            {rows && filtered.length === 0 && (
              <div style={{ padding: 16, color: '#666', fontSize: 11 }}>
                {rows.length ? 'Nothing matches that filter.' : 'No broadcasts recorded yet.'}
              </div>
            )}
            {filtered.map((r) => {
              const on = selected?.id === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid #26262e', cursor: 'pointer', padding: '8px 10px', background: on ? '#22c55e14' : 'transparent', color: '#ccc', font: 'inherit' }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ color: '#888', fontSize: 10 }}>{when(r.sentAt)}</span>
                    {r.refinedText && <span title={'Refined by ' + (r.model ?? 'AI')} style={{ fontSize: 9, color: '#22c55e' }}>✨</span>}
                    {!r.ok && <span title="Some targets did not receive it" style={{ fontSize: 9, color: '#ef4444' }}>✗</span>}
                    <span style={{ color: '#666', fontSize: 10, marginLeft: 'auto' }}>
                      {r.targets.length}{r.targets.length === 1 ? ' target' : ' targets'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: on ? '#e0e0e0' : '#aaa', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {r.refinedText ?? r.originalText}
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!selected && <div style={{ padding: 16, color: '#666' }}>Select a prompt.</div>}
            {selected && (
              <>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #2d2d2d', fontSize: 11, color: '#888' }}>
                  <div>Sent {new Date(selected.sentAt).toLocaleString()}</div>
                  <div style={{ marginTop: 3 }}>To: {selected.targets.length ? selected.targets.join(', ') : '(not recorded)'}</div>
                  {selected.model && (
                    <div style={{ marginTop: 3 }}>
                      Refined by {selected.model}
                      {selected.refineMs != null && ' in ' + (selected.refineMs / 1000).toFixed(2) + 's'}
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {selected.refinedText && (
                    <section>
                      <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 4 }}>SENT (refined)</div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: MONO, fontSize: 11, color: '#e0e0e0', background: '#0d1117', border: '1px solid #333', borderRadius: 4, padding: 10 }}>{selected.refinedText}</pre>
                    </section>
                  )}
                  <section>
                    <div style={{ fontSize: 10, color: selected.refinedText ? '#888' : '#22c55e', marginBottom: 4 }}>
                      {selected.refinedText ? 'ORIGINAL (what you typed)' : 'SENT (as typed)'}
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: MONO, fontSize: 11, color: selected.refinedText ? '#aaa' : '#e0e0e0', background: '#0d1117', border: '1px solid #333', borderRadius: 4, padding: 10 }}>{selected.originalText}</pre>
                  </section>
                </div>

                <footer style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid #2d2d2d' }}>
                  <button
                    style={{ ...btn, background: '#22c55e', color: '#000', border: 'none', fontWeight: 600 }}
                    title="Load the sent text into the composer, where you pick the targets"
                    onClick={() => onReplay(selected.refinedText ?? selected.originalText)}
                  >
                    Replay sent text
                  </button>
                  {selected.refinedText && (
                    <button style={btn} title="Load what you originally typed instead" onClick={() => onReplay(selected.originalText)}>
                      Replay original
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button style={{ ...btn, color: '#ef4444', borderColor: '#ef444455' }} disabled={busy} onClick={() => { void remove(selected.id) }}>
                    Delete
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
