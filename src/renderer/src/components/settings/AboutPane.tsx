import { MONO_FONT } from './controls'
import type { BuildInfo } from './types'

export interface AboutPaneProps {
  appVersion: string
  buildInfo: BuildInfo | null
}

export function AboutPane({ appVersion, buildInfo }: AboutPaneProps) {
  return (
    <div style={{ fontFamily: 'inherit', fontSize: '12px', color: '#ccc', lineHeight: '1.6' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 600 }}>CmdCLD</span>
        <span style={{ color: '#555', fontSize: '11px', fontFamily: MONO_FONT }}>{appVersion ? `v${appVersion}` : ''}</span>
      </div>
      <div style={{ color: '#888', fontSize: '11px', marginBottom: '16px' }}>Multi-terminal agent launcher</div>

      <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '16px', lineHeight: '1.7' }}>
        Created by Leon Nel at i60 Global, an enterprise<br />
        software company building platforms, AI tools,<br />
        and developer utilities for the insurance<br />
        industry since 2005.
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ marginBottom: '4px' }}>
          <a href="https://i60.co" target="_blank" rel="noreferrer" style={{ color: '#22c55e', fontSize: '11px', textDecoration: 'none' }}>
            → i60.co
          </a>
        </div>
        <div>
          <a href="https://github.com/LeonNel123/i60.CmdCLD" target="_blank" rel="noreferrer" style={{ color: '#22c55e', fontSize: '11px', textDecoration: 'none' }}>
            → github.com/LeonNel123/i60.CmdCLD
          </a>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #333', margin: '12px 0' }} />

      <div style={{ color: '#555', fontSize: '11px', marginBottom: '12px' }}>
        © 2026 i60 · Licensed under MIT
      </div>

      <div style={{ borderTop: '1px solid #333', margin: '12px 0' }} />

      <div style={{ color: '#888', fontSize: '11px', marginBottom: '8px' }}>Build info</div>
      {[
        ['Electron', buildInfo?.electron],
        ['Chromium', buildInfo?.chrome],
        ['Node',     buildInfo?.node],
        ['Platform', buildInfo ? `${buildInfo.platform} ${buildInfo.release}` : undefined],
      ].map(([label, value]) => (
        <div key={label as string} style={{ display: 'flex', gap: '12px', marginBottom: '3px' }}>
          <span style={{ color: '#555', fontSize: '11px', width: '70px', flexShrink: 0 }}>{label}</span>
          <span style={{ color: '#aaa', fontSize: '11px', fontFamily: MONO_FONT }}>{value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}
