interface ToastProps {
  message: string
  kind: 'info' | 'warn'
}

export function Toast({ message, kind }: ToastProps) {
  const borderColor = kind === 'warn' ? '#f59e0b' : '#555'
  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      background: '#1a1a2e',
      border: `1px solid ${borderColor}`,
      borderRadius: '6px',
      padding: '10px 14px',
      color: kind === 'warn' ? '#f59e0b' : '#ccc',
      fontSize: '12px',
      fontFamily: 'inherit',
      maxWidth: '360px',
      zIndex: 9000,
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
    }}>
      {message}
    </div>
  )
}
