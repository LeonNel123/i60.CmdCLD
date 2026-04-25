import { useState } from 'react'
import type { RecentFolder } from '../types/api'
import { formatRelativeTime } from '../utils/format-relative-time'

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
  isPlainShell?: boolean
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
  onQuickClaude: () => void
  onQuickShell: () => void
  onNewProject: () => void
  onCloseAll: () => void
  hasProjectsRoot: boolean
  favoriteFolders: string[]
  onToggleFavorite: (path: string) => void
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
  onQuickClaude,
  onQuickShell,
  onOpenSettings,
  onNewProject,
  onCloseAll,
  hasProjectsRoot,
  favoriteFolders,
  onToggleFavorite,
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
      <style>{`
        .recent-row:hover .recent-star { opacity: 1 !important; }
        .recent-row:hover { background: rgba(255,255,255,0.04); }
      `}</style>
      {/* Action buttons */}
      <div style={{ padding: '6px 4px', borderBottom: '1px solid #2d2d2d' }}>
        <button onClick={onAddFolder} style={btnStyle()} title="Open Project — pick a folder to launch Claude in">
          <span style={{ color: '#22c55e', fontSize: '14px', lineHeight: 1 }}>+</span>
          {!collapsed && <span>Open Project</span>}
        </button>
        <button onClick={onQuickClaude} style={btnStyle()} title="Quick Claude (no folder)">
          <span style={{ color: '#fb923c', fontSize: '13px', lineHeight: 1 }}>&gt;</span>
          {!collapsed && <span>Quick Claude</span>}
        </button>
        <button onClick={onQuickShell} style={btnStyle()} title="Quick Shell — plain shell in your home folder">
          <span style={{ color: '#94a3b8', fontSize: '11px', lineHeight: 1, fontFamily: 'monospace' }}>&gt;_</span>
          {!collapsed && <span>Quick Shell</span>}
        </button>
        <button onClick={onNewWindow} style={btnStyle()} title="New Window">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#8862;</span>
          {!collapsed && <span>New Window</span>}
        </button>
        {hasProjectsRoot && (
          <button onClick={onNewProject} style={btnStyle()} title="New Project">
            <span style={{ color: '#38bdf8', fontSize: '14px', lineHeight: 1 }}>&#9733;</span>
            {!collapsed && <span>New Project</span>}
          </button>
        )}
      </div>

      {/* Active terminals */}
      <div style={{ overflowY: 'auto', padding: '4px', flexShrink: 0 }}>
        {[...terminals].sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
          const isActive = viewMode.type === 'focused' && viewMode.terminalId === t.id
          const busy = busyTerminals.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => onSelectTerminal(t.id)}
              style={btnStyle(isActive)}
              title={t.name}
            >
              {t.isPlainShell ? (
                <span style={{
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  color: t.color,
                  flexShrink: 0,
                  lineHeight: 1,
                  opacity: busy ? 1 : 0.7,
                }}>&gt;_</span>
              ) : (
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: t.color,
                  flexShrink: 0,
                  boxShadow: busy ? `0 0 6px 2px ${t.color}80` : 'none',
                  animation: busy ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }} />
              )}
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

      {/* Recent folders — favorites pin to top, then non-favorites sorted by recency */}
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
            <span style={{ fontSize: '10px' }}>{recentExpanded ? '▼' : '▶'}</span>
          </button>
          {recentExpanded && (() => {
            const favSet = new Set(favoriteFolders)
            const sorted = [...recentFolders].sort((a, b) => {
              const aFav = favSet.has(a.path)
              const bFav = favSet.has(b.path)
              if (aFav !== bFav) return aFav ? -1 : 1
              if (aFav && bFav) return a.name.localeCompare(b.name)
              return b.lastOpened - a.lastOpened
            })
            return sorted.map((f) => {
              const isOpen = activePaths.has(f.path)
              const isFav = favSet.has(f.path)
              return (
                <div
                  key={f.path}
                  className="recent-row"
                  onClick={() => { if (!isOpen) onOpenRecent(f.path) }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    width: '100%',
                    padding: '6px 10px',
                    background: 'none',
                    cursor: isOpen ? 'default' : 'pointer',
                    opacity: isOpen ? 0.5 : 1,
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    borderRadius: '3px',
                  }}
                  title={isOpen ? `${f.path} (already open)` : f.path}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(f.path) }}
                    className="recent-star"
                    style={{
                      color: isFav ? '#fbbf24' : '#444',
                      fontSize: '12px',
                      cursor: 'pointer',
                      width: '14px',
                      textAlign: 'center',
                      flexShrink: 0,
                      opacity: isFav ? 1 : 0,
                    }}
                    title={isFav ? 'Unfavorite' : 'Add to favorites'}
                  >
                    {isFav ? '★' : '☆'}
                  </span>
                  <span style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: '#ccc',
                  }}>
                    {f.name}
                  </span>
                  <span style={{ color: '#666', fontSize: '10px', flexShrink: 0 }}>
                    {formatRelativeTime(f.lastOpened)}
                  </span>
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Bottom actions */}
      <div style={{ padding: '6px 4px', borderTop: '1px solid #2d2d2d', flexShrink: 0 }}>
        <button onClick={onShowAll} style={btnStyle(viewMode.type === 'grid')} title="Show All">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#9635;</span>
          {!collapsed && <span>Show All</span>}
        </button>
        {terminals.length > 0 && (
          <button onClick={onCloseAll} style={btnStyle()} title="Close All">
            <span style={{ fontSize: '13px', lineHeight: 1, color: '#f14c4c' }}>&#10005;</span>
            {!collapsed && <span>Close All</span>}
          </button>
        )}
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
