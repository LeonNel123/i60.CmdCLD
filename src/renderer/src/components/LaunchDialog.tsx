import { useState } from 'react'
import { CLAUDE_PRESETS } from '../utils/claude-presets'

interface LaunchDialogProps {
  folderName: string
  defaultArgs: string
  onLaunch: (args: string) => void
  onCancel: () => void
}

export function LaunchDialog({ folderName, defaultArgs, onLaunch, onCancel }: LaunchDialogProps) {
  const [args, setArgs] = useState(defaultArgs)

  const presetBtn = (label: string, value: string) => (
    <button
      key={label}
      onClick={() => setArgs(value)}
      style={{
        background: args === value ? '#22c55e20' : '#ffffff08',
        border: args === value ? '1px solid #22c55e' : '1px solid #333',
        borderRadius: '4px',
        padding: '3px 8px',
        color: args === value ? '#22c55e' : '#aaa',
        fontSize: '11px',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

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
    onClick={onCancel}
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
        <h3 style={{ color: '#e0e0e0', margin: '0 0 14px 0', fontSize: '14px', fontFamily: 'inherit' }}>
          Launch Claude in {folderName}
        </h3>

        {/* Presets */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
            Quick Presets
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {CLAUDE_PRESETS.map((p) => presetBtn(p.label, p.args))}
          </div>
        </div>

        {/* Args text field + clear */}
        <div style={{ marginBottom: '10px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
            Launch Arguments
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onLaunch(args) }}
              autoFocus
              placeholder="e.g. --dangerously-skip-permissions --continue"
              style={{
                flex: 1,
                background: '#0d1117',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '8px 10px',
                color: '#e0e0e0',
                fontSize: '12px',
                fontFamily: 'Menlo, Consolas, monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={() => setArgs('')}
              title="Clear"
              style={{
                background: '#333',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '0 10px',
                color: '#999',
                fontSize: '11px',
                fontFamily: 'inherit',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Preview */}
        <div style={{
          background: '#0d1117',
          borderRadius: '4px',
          padding: '6px 10px',
          marginBottom: '14px',
          border: '1px solid #1e293b',
        }}>
          <span style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace' }}>
            $ claude {args || '(no flags)'}
          </span>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: '#333', color: '#ccc', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onLaunch(args)}
            style={{
              background: '#22c55e', color: '#000', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            Launch
          </button>
        </div>
      </div>
    </div>
  )
}
