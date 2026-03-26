import { useState } from 'react'

interface TerminalEntry {
  id: string
  name: string
  color: string
}

type ViewMode = { type: 'grid' } | { type: 'focused'; terminalId: string }

interface SidebarProps {
  terminals: TerminalEntry[]
  viewMode: ViewMode
  onSelectTerminal: (id: string) => void
  onShowAll: () => void
  onAddFolder: () => void
  onNewWindow: () => void
}

const EXPANDED_WIDTH = 180
const COLLAPSED_WIDTH = 36

export function Sidebar({
  terminals,
  viewMode,
  onSelectTerminal,
  onShowAll,
  onAddFolder,
  onNewWindow,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      return saved === null ? true : saved === 'true'
    } catch { return true }
  })

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
  }

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH

  const btnStyle = (active = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: collapsed ? '6px 0' : '6px 10px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'rgba(255,255,255,0.08)' : 'none',
    border: 'none',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '3px',
    textAlign: 'left',
  })

  return (
    <div style={{
      width,
      minWidth: width,
      height: '100%',
      background: '#0d1117',
      borderRight: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 150ms ease',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Action buttons */}
      <div style={{ padding: '6px 4px', borderBottom: '1px solid #1e293b' }}>
        <button onClick={onAddFolder} style={btnStyle()} title="Add Folder">
          <span style={{ color: '#22c55e', fontSize: '14px', lineHeight: 1 }}>+</span>
          {!collapsed && <span>Add Folder</span>}
        </button>
        <button onClick={onNewWindow} style={btnStyle()} title="New Window">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#8862;</span>
          {!collapsed && <span>New Window</span>}
        </button>
      </div>

      {/* Folder list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
        {terminals.map((t) => {
          const isActive = viewMode.type === 'focused' && viewMode.terminalId === t.id
          return (
            <button
              key={t.id}
              onClick={() => onSelectTerminal(t.id)}
              style={btnStyle(isActive)}
              title={t.name}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: t.color,
                flexShrink: 0,
              }} />
              {!collapsed && (
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {t.name}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ padding: '6px 4px', borderTop: '1px solid #1e293b' }}>
        <button onClick={onShowAll} style={btnStyle(viewMode.type === 'grid')} title="Show All">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#9635;</span>
          {!collapsed && <span>Show All</span>}
        </button>
        <button onClick={toggleCollapsed} style={btnStyle()} title={collapsed ? 'Expand' : 'Collapse'}>
          <span style={{ fontSize: '12px', lineHeight: 1 }}>{collapsed ? '\u25B6' : '\u25C0'}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}
