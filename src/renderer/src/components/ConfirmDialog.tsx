import { useEffect } from 'react'

interface ConfirmDialogProps {
  message: string
  detail?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, detail, confirmLabel = 'Close Terminal', onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

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
      <div style={{
        background: '#1a1a2e',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '400px',
        width: '90%',
        // vh is multiplied by the .ui-scaled zoom, so divide it back out to
        // keep the dialog fitting the real viewport at any interface scale.
        maxHeight: 'calc(85vh / var(--ui-scale-plain, 1))',
        overflowY: 'auto',
        border: '1px solid #333',
      }}>
        <p style={{ color: '#e0e0e0', marginBottom: detail ? '8px' : '20px', fontWeight: 600 }}>{message}</p>
        {detail && (
          <p style={{ color: '#fbbf24', marginBottom: '20px', fontSize: '12px', whiteSpace: 'pre-line' }}>{detail}</p>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: '#333', color: '#ccc', border: 'none',
              borderRadius: '6px', padding: '8px 16px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#ef4444', color: '#fff', border: 'none',
              borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
