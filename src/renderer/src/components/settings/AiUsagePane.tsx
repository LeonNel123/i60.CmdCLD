import { useEffect, useState } from 'react'
import { PaneHeading } from './controls'
import type { AiUsageSummary } from '../../types/api'

const MONO = 'Menlo, Consolas, monospace'

function providerLabel(p: string): string {
  return p === 'anthropic' ? 'Anthropic' : 'OpenRouter'
}

/**
 * Where CmdCLD calls an external model, and what that has actually cost in calls so far.
 *
 * Every row is resolved in the main process from the same settings the runtime reads, so
 * this cannot drift from what the app really does — it is not a written description of
 * the architecture.
 */
export function AiUsagePane() {
  const [data, setData] = useState<AiUsageSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    window.api.aiUsageSummary().then(setData).catch(() => setFailed(true))
  }, [])

  if (failed) return <><PaneHeading>External AI usage</PaneHeading><div style={{ color: '#ef4444', fontSize: 11 }}>Could not read usage.</div></>
  if (!data) return <><PaneHeading>External AI usage</PaneHeading><div style={{ color: '#666', fontSize: 11 }}>Loading…</div></>

  const missingKey = (p: string): boolean => (p === 'anthropic' ? !data.keys.anthropic : !data.keys.openrouter)

  return (
    <>
      <PaneHeading>External AI usage</PaneHeading>

      <div style={{ color: '#888', fontSize: 11, lineHeight: 1.6, marginBottom: 14 }}>
        Everything below calls a model over the network and costs money. Local CLI agents
        (Claude Code, Codex) are not listed — those run under your own subscription and are
        not billed through these keys.
      </div>

      {/* Keys */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {(['anthropic', 'openrouter'] as const).map((p) => {
          const has = p === 'anthropic' ? data.keys.anthropic : data.keys.openrouter
          return (
            <div key={p} style={{
              flex: '1 1 180px', background: '#1a1a1a', border: '1px solid #2a2a2a',
              borderRadius: 4, padding: '8px 10px',
            }}>
              <div style={{ fontSize: 11, color: '#ccc' }}>{providerLabel(p)} key</div>
              <div style={{ fontSize: 11, color: has ? '#22c55e' : '#ef4444', marginTop: 3 }}>
                {has ? '✓ configured' : '✗ not set'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Call sites */}
      <h4 style={{ color: '#e0e0e0', margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Where models are called</h4>
      <div style={{ color: '#666', fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
        Resolved from your current settings. The planner model is shared by every Autopilot
        path — changing it changes all of them at once.
      </div>

      <div style={{ border: '1px solid #2a2a2a', borderRadius: 4, overflow: 'hidden', marginBottom: 18 }}>
        {data.sites.map((s, i) => (
          <div
            key={s.id}
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px',
              background: i % 2 ? '#171717' : '#1c1c1c',
              borderTop: i ? '1px solid #242424' : 'none',
            }}
          >
            <div style={{ flex: '1 1 40%', minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#e0e0e0' }}>{s.label}</div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2, lineHeight: 1.45 }}>{s.what}</div>
            </div>
            <div style={{ flex: '1 1 35%', minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#9a9a9a', fontFamily: MONO, wordBreak: 'break-all' }}>
                {s.model}
              </div>
              <div style={{ fontSize: 10, color: missingKey(s.provider) ? '#ef4444' : '#555', marginTop: 2 }}>
                {providerLabel(s.provider)}{missingKey(s.provider) && ' — key missing, this will fail'}
              </div>
            </div>
            <div style={{ flex: '0 0 22%', fontSize: 10, color: '#555', textAlign: 'right' }}>
              {s.setting}
            </div>
          </div>
        ))}
      </div>

      {/* Measured refine history */}
      <h4 style={{ color: '#e0e0e0', margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Refine history</h4>
      <div style={{ color: '#666', fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
        Counted from the broadcast log, which keeps the last 500 sends. Refine is the only
        path with a per-call record, so this is measured rather than estimated — Autopilot
        spend is tracked by its daily budget instead.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          ['Broadcasts logged', String(data.broadcastsLogged)],
          ['Refined by AI', String(data.refine.count)],
          ['Average refine', data.refine.avgMs == null ? '—' : (data.refine.avgMs / 1000).toFixed(2) + 's'],
        ].map(([label, value]) => (
          <div key={label} style={{
            flex: '1 1 140px', background: '#1a1a1a', border: '1px solid #2a2a2a',
            borderRadius: 4, padding: '8px 10px',
          }}>
            <div style={{ fontSize: 10, color: '#666' }}>{label}</div>
            <div style={{ fontSize: 16, color: '#e0e0e0', marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>

      {Object.keys(data.refine.byModel).length > 0 && (
        <div style={{ border: '1px solid #2a2a2a', borderRadius: 4, overflow: 'hidden' }}>
          {Object.entries(data.refine.byModel)
            .sort((a, b) => b[1] - a[1])
            .map(([model, n], i) => (
              <div key={model} style={{
                display: 'flex', justifyContent: 'space-between', padding: '7px 11px',
                background: i % 2 ? '#171717' : '#1c1c1c',
                borderTop: i ? '1px solid #242424' : 'none',
                fontSize: 10,
              }}>
                <span style={{ color: '#9a9a9a', fontFamily: MONO }}>{model}</span>
                <span style={{ color: '#666' }}>{n}{n === 1 ? ' refine' : ' refines'}</span>
              </div>
            ))}
        </div>
      )}

      {data.refine.count === 0 && (
        <div style={{ color: '#666', fontSize: 11 }}>
          No AI-refined broadcasts recorded yet.
        </div>
      )}
    </>
  )
}
