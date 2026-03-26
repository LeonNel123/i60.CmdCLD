interface TopBarProps {
  count: number
  onAdd: () => void
}

export function TopBar({ count, onAdd }: TopBarProps) {
  return (
    <div style={{
      background: '#16213e',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid #0f3460',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '14px', fontFamily: 'monospace' }}>
          CmdCLD
        </span>
        <span style={{ color: '#666', fontSize: '12px' }}>
          {count} session{count !== 1 ? 's' : ''}
        </span>
      </div>
      <button
        onClick={onAdd}
        style={{
          background: '#22c55e',
          color: '#000',
          border: 'none',
          borderRadius: '6px',
          padding: '6px 16px',
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        + Add Folder
      </button>
    </div>
  )
}
