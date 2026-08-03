// Bottom taskbar for minimized terminals. Renders nothing while no terminal
// is minimized. Each chip restores its terminal on click; the ✕ requests a
// close (same confirm flow as the tile's own close button). A minimized
// terminal stays fully alive — its pty, autopilot and relays keep running —
// so the chip surfaces liveness: amber pulse while busy, green ring once it
// went idle while minimized (finished something and wants attention).

export interface TaskBarItem {
  id: string
  name: string
  color: string
  busy: boolean
  attention: boolean
}

interface TaskBarProps {
  items: TaskBarItem[]
  onRestore: (id: string) => void
  onClose: (id: string) => void
}

export function TaskBar({ items, onRestore, onClose }: TaskBarProps) {
  if (items.length === 0) return null
  return (
    <div style={{
      height: '30px',
      flexShrink: 0,
      background: '#252526',
      borderTop: '1px solid #333',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '0 8px',
      overflowX: 'auto',
      overflowY: 'hidden',
    }}>
      <style>{'@keyframes taskbar-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }'}</style>
      {items.map((item) => (
        <div
          key={item.id}
          onClick={() => onRestore(item.id)}
          title={`Restore "${item.name}"${item.busy ? ' (busy)' : item.attention ? ' (finished while minimized)' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 4px 2px 8px',
            borderRadius: '4px',
            border: `1px solid ${item.attention ? '#4ade80' : '#3c3c3c'}`,
            background: '#1e1e1e',
            cursor: 'pointer',
            flexShrink: 0,
            maxWidth: '180px',
            height: '22px',
          }}
        >
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            flexShrink: 0,
            background: item.busy ? '#fbbf24' : item.attention ? '#4ade80' : item.color,
            animation: item.busy ? 'taskbar-pulse 1.2s ease-in-out infinite' : undefined,
          }} />
          <span style={{
            color: '#ccc',
            fontSize: '12px',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {item.name}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(item.id) }}
            title="Close terminal"
            style={{
              background: 'none', border: 'none', color: '#666',
              cursor: 'pointer', fontSize: '11px', padding: '0 4px',
              lineHeight: 1, flexShrink: 0,
            }}
          >
            &#10005;
          </button>
        </div>
      ))}
    </div>
  )
}
