import { useState, useEffect } from 'react'
import { CLAUDE_PRESETS } from '../utils/claude-presets'

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [claudeArgs, setClaudeArgs] = useState('')
  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.settingsGetAll().then((s) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
      setLoaded(true)
    })
  }, [])

  const save = () => {
    window.api.settingsSet('claudeArgs', claudeArgs)
    window.api.settingsSet('askBeforeLaunch', askBeforeLaunch)
    onClose()
  }

  if (!loaded) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 3000,
    }}
    onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a2e',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '520px',
          width: '90%',
          border: '1px solid #333',
        }}
      >
        <h3 style={{ color: '#e0e0e0', margin: '0 0 16px 0', fontSize: '14px', fontFamily: 'monospace' }}>
          Claude CLI Settings
        </h3>

        {/* Presets */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Quick Presets
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {CLAUDE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setClaudeArgs(p.args)}
                style={{
                  background: claudeArgs === p.args ? '#22c55e20' : '#ffffff08',
                  border: claudeArgs === p.args ? '1px solid #22c55e' : '1px solid #333',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  color: claudeArgs === p.args ? '#22c55e' : '#aaa',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Args text field */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Default Launch Arguments
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={claudeArgs}
              onChange={(e) => setClaudeArgs(e.target.value)}
              placeholder="e.g. --dangerously-skip-permissions --continue"
              style={{
                flex: 1,
                background: '#0d1117',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '8px 10px',
                color: '#e0e0e0',
                fontSize: '12px',
                fontFamily: 'Consolas, monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={() => setClaudeArgs('')}
              title="Clear"
              style={{
                background: '#333',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '0 10px',
                color: '#999',
                fontSize: '11px',
                fontFamily: 'monospace',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Clear
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>
            These flags are passed to `claude` when opening a new terminal
          </div>
        </div>

        {/* Ask before launch toggle */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            color: '#ccc',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}>
            <input
              type="checkbox"
              checked={askBeforeLaunch}
              onChange={(e) => setAskBeforeLaunch(e.target.checked)}
              style={{ accentColor: '#22c55e' }}
            />
            Ask before launch (edit flags each time)
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: '#333', color: '#ccc', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'monospace',
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              background: '#22c55e', color: '#000', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'monospace', fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
