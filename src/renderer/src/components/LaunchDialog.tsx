import { useState } from 'react'

interface LaunchDialogProps {
  folderName: string
  defaultArgs: string
  onLaunch: (args: string) => void
  onCancel: () => void
}

export function LaunchDialog({ folderName, defaultArgs, onLaunch, onCancel }: LaunchDialogProps) {
  const [args, setArgs] = useState(defaultArgs)

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
          maxWidth: '480px',
          width: '90%',
          border: '1px solid #333',
        }}
      >
        <h3 style={{ color: '#e0e0e0', margin: '0 0 12px 0', fontSize: '13px', fontFamily: 'monospace' }}>
          Launch Claude in {folderName}
        </h3>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Arguments
          </label>
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onLaunch(args) }}
            autoFocus
            placeholder="e.g. --dangerously-skip-permissions --continue"
            style={{
              width: '100%',
              background: '#0d1117',
              border: '1px solid #333',
              borderRadius: '4px',
              padding: '8px 10px',
              color: '#e0e0e0',
              fontSize: '12px',
              fontFamily: 'Consolas, monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', marginBottom: '12px' }}>
          Will run: claude {args || '(no flags)'}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: '#333', color: '#ccc', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'monospace',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onLaunch(args)}
            style={{
              background: '#22c55e', color: '#000', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'monospace', fontWeight: 600,
            }}
          >
            Launch
          </button>
        </div>
      </div>
    </div>
  )
}
