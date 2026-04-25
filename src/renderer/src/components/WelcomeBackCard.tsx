interface WelcomeBackCardProps {
  count: number
  onReopen: () => void
  onDismiss: () => void
}

export function WelcomeBackCard({ count, onReopen, onDismiss }: WelcomeBackCardProps) {
  if (count <= 0) return null

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: '#1a1a2e',
      border: '1px solid #2d2d2d',
      borderRadius: '8px',
      padding: '20px 22px',
      width: '320px',
      maxWidth: '85%',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ color: '#a78bfa', fontSize: '13px' }}>↻ Welcome back</span>
        <button
          onClick={onDismiss}
          title="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 4px',
          }}
        >×</button>
      </div>
      <div style={{ color: '#aaa', fontSize: '12px', lineHeight: 1.5, marginBottom: '14px' }}>
        You had {count} project{count === 1 ? '' : 's'} open last time.
      </div>
      <button
        onClick={onReopen}
        style={{
          background: '#a78bfa',
          color: '#000',
          border: 'none',
          borderRadius: '4px',
          padding: '6px 14px',
          cursor: 'pointer',
          fontSize: '12px',
          fontFamily: 'monospace',
          fontWeight: 600,
        }}
      >
        Reopen them
      </button>
    </div>
  )
}
