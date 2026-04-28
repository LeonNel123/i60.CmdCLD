interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={{
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
        border: '1px solid #333',
      }}>
        <p style={{ color: '#e0e0e0', marginBottom: '20px', fontWeight: 600 }}>{message}</p>
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
            Close Terminal
          </button>
        </div>
      </div>
    </div>
  )
}
