import { useState, memo } from 'react'
import type { RecentFolder } from '../types/api'
import { formatRelativeTime } from '../utils/format-relative-time'
import {
  ChevronLeft, ChevronRight, ChevronDown, Star, X, LayoutGrid,
  FolderOpen, Sparkles, TerminalSquare, AppWindow, FolderPlus, Settings,
} from './icons'

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
  busyTerminals: Set<string>
  recentFolders: RecentFolder[]
  onOpenRecent: (path: string) => void
  onCloseAll: () => void
  favoriteFolders: string[]
  onToggleFavorite: (path: string) => void
  onContextMenu: (path: string, x: number, y: number) => void
  onAddFolder: () => void
  onQuickAgent: () => void
  onQuickShell: () => void
  onQuickShellContextMenu?: (x: number, y: number) => void
  onNewWindow: () => void
  onNewProject: () => void
  onOpenSettings: () => void
  hasProjectsRoot: boolean
  uiScale?: number
}

const COLLAPSED_WIDTH = 36
const DEFAULT_EXPANDED_WIDTH = 200
const MIN_EXPANDED_WIDTH = 150
const MAX_EXPANDED_WIDTH = 420

interface RecentRowProps {
  folder: RecentFolder
  isOpen: boolean
  isFav: boolean
  isFavoriteSection: boolean
  onOpen: (path: string) => void
  onToggleFavorite: (path: string) => void
  onContextMenu: (path: string, x: number, y: number) => void
}

const RecentRow = memo(function RecentRow({
  folder,
  isOpen,
  isFav,
  isFavoriteSection,
  onOpen,
  onToggleFavorite,
  onContextMenu,
}: RecentRowProps) {
  return (
    <div
      className="recent-row"
      onClick={() => { if (!isOpen) onOpen(folder.path) }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(folder.path, e.clientX, e.clientY)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: 'auto',
        padding: '5px 12px',
        margin: '0 4px',
        background: 'none',
        cursor: isOpen ? 'default' : 'pointer',
        opacity: isOpen ? 0.55 : 1,
        fontFamily: 'inherit',
        fontSize: '13px',
        borderRadius: '6px',
        transition: 'background 80ms ease',
      }}
      title={isOpen ? `${folder.path} (already open — right-click to add another CLI)` : folder.path}
    >
      <span
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(folder.path) }}
        className="recent-star"
        style={{
          color: isFav ? '#fbbf24' : '#666',
          cursor: 'pointer',
          width: '14px',
          flexShrink: 0,
          opacity: isFavoriteSection ? 1 : 0,
          display: 'flex',
          alignItems: 'center',
        }}
        title={isFav ? 'Unfavorite' : 'Add to favorites'}
      >
        <Star width={12} height={12} fill={isFavoriteSection ? 'currentColor' : 'none'} />
      </span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: '#ccc',
      }}>
        {folder.name}
      </span>
      <span style={{ color: '#5a5a5a', fontSize: '10px', flexShrink: 0, fontFamily: 'Menlo, Consolas, monospace' }}>
        {formatRelativeTime(folder.lastOpened)}
      </span>
    </div>
  )
})

export function Sidebar({
  terminals,
  viewMode,
  onSelectTerminal,
  onShowAll,
  recentFolders,
  busyTerminals,
  onOpenRecent,
  onCloseAll,
  favoriteFolders,
  onToggleFavorite,
  onContextMenu,
  onAddFolder,
  onQuickAgent,
  onQuickShell,
  onQuickShellContextMenu,
  onNewWindow,
  onNewProject,
  onOpenSettings,
  hasProjectsRoot,
  uiScale = 1,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      return saved === null ? true : saved === 'true'
    } catch { return true }
  })

  const [expandedWidth, setExpandedWidth] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('sidebar-width') || '', 10)
      if (Number.isFinite(saved)) return Math.min(Math.max(saved, MIN_EXPANDED_WIDTH), MAX_EXPANDED_WIDTH)
    } catch {}
    return DEFAULT_EXPANDED_WIDTH
  })
  const [resizing, setResizing] = useState(false)

  const [recentExpanded, setRecentExpanded] = useState(() => {
    try {
      return localStorage.getItem('sidebar-recent-expanded') !== 'false'
    } catch { return true }
  })

  const [favoritesExpanded, setFavoritesExpanded] = useState(() => {
    try {
      return localStorage.getItem('sidebar-favorites-expanded') !== 'false'
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

  const toggleFavorites = () => {
    const next = !favoritesExpanded
    setFavoritesExpanded(next)
    try { localStorage.setItem('sidebar-favorites-expanded', String(next)) } catch {}
  }

  // Drag the right edge to resize the expanded panel. Width is clamped and
  // persisted; the container's width transition is disabled mid-drag so it
  // tracks the pointer instead of lagging behind.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = expandedWidth
    let latest = startW
    setResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent) => {
      // The panel box is zoomed by uiScale, so a pointer move of dx real px
      // corresponds to dx/uiScale of unscaled width. Divide so the edge tracks
      // the cursor 1:1 at any interface scale.
      const dx = (ev.clientX - startX) / (uiScale || 1)
      latest = Math.min(Math.max(startW + dx, MIN_EXPANDED_WIDTH), MAX_EXPANDED_WIDTH)
      setExpandedWidth(latest)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setResizing(false)
      try { localStorage.setItem('sidebar-width', String(latest)) } catch {}
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const width = collapsed ? COLLAPSED_WIDTH : expandedWidth
  const activePaths = new Set(terminals.map((t) => t.path))

  const btnStyle = (active = false, disabled = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: 'auto',
    padding: collapsed ? '5px 0' : '5px 12px',
    margin: '0 4px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'rgba(255,255,255,0.08)' : 'none',
    border: 'none',
    color: disabled ? '#444' : '#d8d8d8',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '13px',
    fontFamily: 'inherit',
    borderRadius: '6px',
    textAlign: 'left',
    opacity: disabled ? 0.5 : 1,
    transition: 'background 80ms ease',
    position: 'relative',
  })

  const sectionHeadingStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 'auto',
    padding: '4px 12px',
    margin: '10px 4px 2px',
    background: 'none',
    border: 'none',
    color: '#5e5e5e',
    fontSize: '12px',
    fontFamily: 'inherit',
    fontWeight: 500,
    letterSpacing: 'normal',
    cursor: 'pointer',
    borderRadius: '6px',
    textAlign: 'left',
  }


  return (
    <div className="ui-scaled" style={{
      width,
      minWidth: width,
      height: '100%',
      background: '#1a1a1a',
      borderRight: '1px solid #2a2a2a',
      display: 'flex',
      flexDirection: 'column',
      transition: resizing ? 'none' : 'width 150ms ease',
      overflow: 'hidden',
      flexShrink: 0,
      position: 'relative',
    }}>
      <style>{`
        .recent-row:hover .recent-star { opacity: 1 !important; }
        .recent-row:hover { background: rgba(255,255,255,0.05); }
        .sidebar-btn:hover { background: rgba(255,255,255,0.05) !important; }
        .sidebar-resize-handle:hover { background: rgba(255,255,255,0.14); }
        .sidebar-btn.active-session::before {
          content: '';
          position: absolute;
          left: -4px;
          top: 8px;
          bottom: 8px;
          width: 2px;
          border-radius: 1px;
          background: var(--accent, #6b9bff);
        }
      `}</style>

      {/* Primary actions (formerly the icon rail) */}
      <div style={{ padding: '4px', borderBottom: '1px solid #2d2d2d', flexShrink: 0 }}>
        <button onClick={onAddFolder} style={btnStyle()} className="sidebar-btn" title="Open Project — pick a folder to launch the default agent in">
          <span style={{ color: '#22c55e', display: 'flex', flexShrink: 0 }}><FolderOpen width={14} height={14} /></span>
          {!collapsed && <span>Open Project</span>}
        </button>
        <button onClick={onQuickAgent} style={btnStyle()} className="sidebar-btn" title="Quick Agent (home folder)">
          <span style={{ color: '#fb923c', display: 'flex', flexShrink: 0 }}><Sparkles width={14} height={14} /></span>
          {!collapsed && <span>Quick Agent</span>}
        </button>
        <button
          onClick={onQuickShell}
          onContextMenu={(e) => {
            if (!onQuickShellContextMenu) return
            e.preventDefault()
            onQuickShellContextMenu(e.clientX, e.clientY)
          }}
          style={btnStyle()}
          className="sidebar-btn"
          title={onQuickShellContextMenu
            ? 'Quick Shell — plain shell in your home folder (right-click: run as administrator)'
            : 'Quick Shell — plain shell in your home folder'}
        >
          <span style={{ color: '#94a3b8', display: 'flex', flexShrink: 0 }}><TerminalSquare width={14} height={14} /></span>
          {!collapsed && <span>Quick Shell</span>}
        </button>
        <button onClick={onNewWindow} style={btnStyle()} className="sidebar-btn" title="New Window">
          <span style={{ color: '#aaa', display: 'flex', flexShrink: 0 }}><AppWindow width={14} height={14} /></span>
          {!collapsed && <span>New Window</span>}
        </button>
        {hasProjectsRoot && (
          <button onClick={onNewProject} style={btnStyle()} className="sidebar-btn" title="New Project">
            <span style={{ color: '#38bdf8', display: 'flex', flexShrink: 0 }}><FolderPlus width={14} height={14} /></span>
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
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu(t.path, e.clientX, e.clientY)
              }}
              style={{
                ...btnStyle(isActive),
                ...(isActive ? { '--accent': t.color } as React.CSSProperties : {}),
              }}
              className={'sidebar-btn' + (isActive ? ' active-session' : '')}
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
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: t.color,
                  flexShrink: 0,
                  boxShadow: busy
                    ? `0 0 8px 2px ${t.color}80, 0 0 0 2px rgba(255,255,255,0.04)`
                    : '0 0 0 2px rgba(255,255,255,0.04)',
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

      {/* Favorites and Recent subsections */}
      {!collapsed && recentFolders.length > 0 && (() => {
        const favSet = new Set(favoriteFolders)
        const favorites = recentFolders.filter((f) => favSet.has(f.path)).sort((a, b) => a.name.localeCompare(b.name))
        const recents = recentFolders.filter((f) => !favSet.has(f.path)).sort((a, b) => b.lastOpened - a.lastOpened)
        return (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {favorites.length > 0 && (
              <div>
                <button
                  onClick={toggleFavorites}
                  style={sectionHeadingStyle}
                  className="sidebar-btn"
                >
                  <span>favorites</span>
                  {favoritesExpanded ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
                </button>
                {favoritesExpanded && favorites.map((f) => (
                  <RecentRow
                    key={f.path}
                    folder={f}
                    isOpen={activePaths.has(f.path)}
                    isFav={true}
                    isFavoriteSection={true}
                    onOpen={onOpenRecent}
                    onToggleFavorite={onToggleFavorite}
                    onContextMenu={onContextMenu}
                  />
                ))}
              </div>
            )}
            {recents.length > 0 && (
              <div>
                <button
                  onClick={toggleRecent}
                  style={sectionHeadingStyle}
                  className="sidebar-btn"
                >
                  <span>recents</span>
                  {recentExpanded ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
                </button>
                {recentExpanded && recents.map((f) => (
                  <RecentRow
                    key={f.path}
                    folder={f}
                    isOpen={activePaths.has(f.path)}
                    isFav={false}
                    isFavoriteSection={false}
                    onOpen={onOpenRecent}
                    onToggleFavorite={onToggleFavorite}
                    onContextMenu={onContextMenu}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* Keep a flexible spacer whenever the Favorites/Recent section (which
          normally provides the flex:1 growth) isn't rendered — e.g. when
          collapsed or with no recents — so the bottom actions stay pinned to
          the bottom instead of riding up under the terminals. */}
      {(collapsed || recentFolders.length === 0) && <div style={{ flex: 1 }} />}

      {/* Bottom actions — elevated card group when expanded; the card's 8px
          margins don't fit the 36px collapsed rail, so collapsed keeps the
          flat divider look. */}
      <div style={collapsed ? {
        padding: '8px 4px',
        borderTop: '1px solid #2a2a2a',
        flexShrink: 0,
      } : {
        margin: '8px',
        padding: '4px',
        background: '#202020',
        border: '1px solid #2a2a2a',
        borderRadius: '8px',
        flexShrink: 0,
      }}>
        <button onClick={onShowAll} style={{ ...btnStyle(viewMode.type === 'grid'), margin: 0 }} className="sidebar-btn" title="Show All">
          <LayoutGrid width={14} height={14} />
          {!collapsed && <span>Show All</span>}
        </button>
        {terminals.length > 0 && (
          <button onClick={onCloseAll} style={{ ...btnStyle(), margin: 0 }} className="sidebar-btn" title="Close All">
            <X width={14} height={14} style={{ color: '#f14c4c' }} />
            {!collapsed && <span>Close All</span>}
          </button>
        )}
        <button onClick={onOpenSettings} style={{ ...btnStyle(), margin: 0 }} className="sidebar-btn" title="Settings">
          <span style={{ color: '#aaa', display: 'flex', flexShrink: 0 }}><Settings width={14} height={14} /></span>
          {!collapsed && <span>Settings</span>}
        </button>
        <button onClick={toggleCollapsed} style={{ ...btnStyle(), margin: 0 }} className="sidebar-btn" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight width={14} height={14} /> : <ChevronLeft width={14} height={14} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      {/* Right-edge resize handle (expanded only) */}
      {!collapsed && (
        <div
          onMouseDown={startResize}
          onDoubleClick={() => { setExpandedWidth(DEFAULT_EXPANDED_WIDTH); try { localStorage.setItem('sidebar-width', String(DEFAULT_EXPANDED_WIDTH)) } catch {} }}
          className="sidebar-resize-handle"
          title="Drag to resize · double-click to reset"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '5px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 10,
          }}
        />
      )}
    </div>
  )
}
