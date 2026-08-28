import { useEffect, useMemo, useState } from 'react'
import type { OpenRouterCatalogueModel } from '../types/api'

/**
 * Shared access to the live OpenRouter catalogue for every place a model is chosen.
 *
 * The catalogue is ~400 entries that change without a release, so no picker in this app
 * enumerates models in source any more. The curated lists that remain (Autopilot planner
 * picks, Broadcast refine picks, launch pins) are *judgment* — "this one drives a tool
 * loop well" — which no catalogue can supply. This component supplies the facts they sit
 * on top of: what exists, what it costs, how much context it has.
 */
export function useOpenRouterCatalogue() {
  const [models, setModels] = useState<OpenRouterCatalogueModel[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.openrouterModels().then((c) => {
      if (cancelled) return
      setModels(c.models)
      setFetchedAt(c.fetchedAt)
    }).catch(() => {
      // Leave the list empty; callers fall back to their curated entries.
    })
    return () => { cancelled = true }
  }, [])

  async function refresh() {
    setRefreshing(true)
    try {
      const c = await window.api.openrouterModels(true)
      setModels(c.models)
      setFetchedAt(c.fetchedAt)
    } catch {
      // Offline: keep the stale list, which is still the best answer available.
    } finally {
      setRefreshing(false)
    }
  }

  return { models, fetchedAt, refreshing, refresh }
}

export function formatRate(m: OpenRouterCatalogueModel): string {
  return `$${m.rate.input.toFixed(2)} / $${m.rate.output.toFixed(2)} per 1M`
}

interface Props {
  value: string
  onChange: (modelId: string) => void
  /** Hide models that cannot drive a tool loop. Launch pickers need this; planner and
   *  refine models are single-shot chat calls, so they do not. */
  toolsOnly?: boolean
  placeholder?: string
}

export function OpenRouterModelSearch({ value, onChange, toolsOnly, placeholder }: Props) {
  const { models, fetchedAt, refreshing, refresh } = useOpenRouterCatalogue()
  const [query, setQuery] = useState('')

  const pool = useMemo(
    () => (toolsOnly ? models.filter((m) => m.supportsTools) : models),
    [models, toolsOnly],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return pool
      .filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .sort((a, b) => a.rate.input - b.rate.input)
      .slice(0, 40)
  }, [query, pool])

  const current = models.find((m) => m.id === value)

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? (pool.length ? `Search ${pool.length} models…` : 'Loading models…')}
        style={{
          width: '100%', boxSizing: 'border-box', background: '#ffffff08',
          border: '1px solid #333', borderRadius: 4, padding: '4px 8px',
          color: '#ccc', fontSize: 11, fontFamily: 'inherit',
        }}
      />

      {matches.length > 0 && (
        <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid #333', borderTop: 'none', borderRadius: '0 0 4px 4px' }}>
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { onChange(m.id); setQuery('') }}
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%',
                background: 'transparent', border: 'none', borderBottom: '1px solid #222',
                padding: '5px 8px', color: '#bbb', fontSize: 11, fontFamily: 'inherit',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.id}</span>
              <span style={{ color: '#666', whiteSpace: 'nowrap' }}>{formatRate(m)}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ color: '#666', fontSize: 10, marginTop: 5 }}>
        {current
          ? `${formatRate(current)} · ${Math.round(current.contextLength / 1000)}k context`
          : value
            ? 'Not in the OpenRouter catalogue — priced at the conservative default'
            : ''}
        {current || value ? ' · ' : ''}
        {fetchedAt > 0 ? `updated ${new Date(fetchedAt).toLocaleDateString()}` : 'bundled list'}
        {' · '}
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          style={{ background: 'none', border: 'none', padding: 0, color: '#7aa2f7', fontSize: 10, fontFamily: 'inherit', cursor: refreshing ? 'default' : 'pointer' }}
        >
          {refreshing ? 'checking…' : 'refresh'}
        </button>
      </div>
    </div>
  )
}
