import { useState } from 'react'
import type { RecentFolder } from '../types/api'

interface TerminalEntry {
  id: string
  path: string
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
  busyTerminals: Set<string>
  recentFolders: RecentFolder[]
  onOpenRecent: (path: string) => void
  onOpenSettings: () => void
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
  recentFolders,
  busyTerminals,
  onOpenRecent,
  onOpenSettings,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      return saved === null ? true : saved === 'true'
    } catch { return true }
  })

  const [recentExpanded, setRecentExpanded] = useState(() => {
    try {
      return localStorage.getItem('sidebar-recent-expanded') !== 'false'
    } catch { return true }
  })

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
  }

  const toggleRecent = () => {
    const next = !recentExpanded
    setRecentExpanded(next)
    try { localStorage.setItem('sidebar-recent-expanded', String(next)) } catch {}
  }

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
  const activePaths = new Set(terminals.map((t) => t.path))

  const btnStyle = (active = false, disabled = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: collapsed ? '6px 0' : '6px 10px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'rgba(255,255,255,0.08)' : 'none',
    border: 'none',
    color: disabled ? '#444' : '#ccc',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '3px',
    textAlign: 'left',
    opacity: disabled ? 0.5 : 1,
  })

  return (
    <div style={{
      width,
      minWidth: width,
      height: '100%',
      background: '#181818',
      borderRight: '1px solid #2d2d2d',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 150ms ease',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Action buttons */}
      <div style={{ padding: '6px 4px', borderBottom: '1px solid #2d2d2d' }}>
        <button onClick={onAddFolder} style={btnStyle()} title="Add Folder">
          <span style={{ color: '#22c55e', fontSize: '14px', lineHeight: 1 }}>+</span>
          {!collapsed && <span>Add Folder</span>}
        </button>
        <button onClick={onNewWindow} style={btnStyle()} title="New Window">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#8862;</span>
          {!collapsed && <span>New Window</span>}
        </button>
      </div>

      {/* Active terminals */}
      <div style={{ overflowY: 'auto', padding: '4px', flexShrink: 0 }}>
        {terminals.map((t) => {
          const isActive = viewMode.type === 'focused' && viewMode.terminalId === t.id
          const busy = busyTerminals.has(t.id)
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
                boxShadow: busy ? `0 0 6px 2px ${t.color}80` : 'none',
                animation: busy ? 'pulse 1.5s ease-in-out infinite' : 'none',
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

      {/* Recent folders — expandable, hidden when sidebar collapsed */}
      {!collapsed && recentFolders.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid #2d2d2d' }}>
          <button
            onClick={toggleRecent}
            style={{
              ...btnStyle(),
              padding: '6px 10px',
              color: '#888',
              fontSize: '11px',
              justifyContent: 'space-between',
            }}
          >
            <span>Recent</span>
            <span style={{ fontSize: '10px' }}>{recentExpanded ? '\u25BC' : '\u25B6'}</span>
          </button>
          {recentExpanded && recentFolders.map((f) => {
            const isOpen = activePaths.has(f.path)
            return (
              <button
                key={f.path}
                onClick={() => { if (!isOpen) onOpenRecent(f.path) }}
                style={btnStyle(false, isOpen)}
                title={isOpen ? `${f.path} (already open)` : f.path}
              >
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: isOpen ? '#333' : '#555',
                  flexShrink: 0,
                }} />
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {f.name}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Bottom actions */}
      <div style={{ padding: '6px 4px', borderTop: '1px solid #2d2d2d', flexShrink: 0 }}>
        <button onClick={onShowAll} style={btnStyle(viewMode.type === 'grid')} title="Show All">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#9635;</span>
          {!collapsed && <span>Show All</span>}
        </button>
        <button onClick={onOpenSettings} style={btnStyle()} title="Settings">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#9881;</span>
          {!collapsed && <span>Settings</span>}
        </button>
        <button onClick={toggleCollapsed} style={btnStyle()} title={collapsed ? 'Expand' : 'Collapse'}>
          <span style={{ fontSize: '12px', lineHeight: 1 }}>{collapsed ? '\u25B6' : '\u25C0'}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}
