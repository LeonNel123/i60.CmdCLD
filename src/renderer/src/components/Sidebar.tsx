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
  isFav: boolean
  isFavoriteSection: boolean
  onOpen: (path: string) => void
  onToggleFavorite: (path: string) => void
  onContextMenu: (path: string, x: number, y: number) => void
}

const RecentRow = memo(function RecentRow({
  folder,
  isFav,
  isFavoriteSection,
  onOpen,
  onToggleFavorite,
  onContextMenu,
}: RecentRowProps) {
  return (
    <div
      className="recent-row"
      onClick={() => onOpen(folder.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(folder.path, e.clientX, e.clientY)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '6px 10px',
        background: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '12px',
        borderRadius: '3px',
      }}
      title={folder.path}
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
      <span style={{ color: '#666', fontSize: '10px', flexShrink: 0, fontFamily: 'Menlo, Consolas, monospace' }}>
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

  const [actionsExpanded, setActionsExpanded] = useState(() => {
    try {
      return localStorage.getItem('sidebar-actions-expanded') !== 'false'
    } catch { return true }
  })

  const [activeExpanded, setActiveExpanded] = useState(() => {
    try {
      return localStorage.getItem('sidebar-active-expanded') !== 'false'
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

  const toggleActions = () => {
    const next = !actionsExpanded
    setActionsExpanded(next)
    try { localStorage.setItem('sidebar-actions-expanded', String(next)) } catch {}
  }

  const toggleActive = () => {
    const next = !activeExpanded
    setActiveExpanded(next)
    try { localStorage.setItem('sidebar-active-expanded', String(next)) } catch {}
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
    width: '100%',
    padding: collapsed ? '6px 0' : '6px 10px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'rgba(255,255,255,0.10)' : 'none',
    border: 'none',
    color: disabled ? '#444' : '#ccc',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '12px',
    fontFamily: 'inherit',
    borderRadius: '3px',
    textAlign: 'left',
    opacity: disabled ? 0.5 : 1,
  })

  const sectionHeadingStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '5px 10px',
    background: 'none',
    border: 'none',
    color: '#777',
    fontSize: '10px',
    fontFamily: 'inherit',
    fontWeight: 600,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    borderRadius: '3px',
    textAlign: 'left',
  }


  return (
    <div className="ui-scaled" style={{
      width,
      minWidth: width,
      height: '100%',
      background: '#181818',
      borderRight: '1px solid #2d2d2d',
      display: 'flex',
      flexDirection: 'column',
      transition: resizing ? 'none' : 'width 150ms ease',
      overflow: 'hidden',
      flexShrink: 0,
      position: 'relative',
    }}>
      <style>{`
        .recent-row:hover .recent-star { opacity: 1 !important; }
        .recent-row:hover { background: rgba(255,255,255,0.06); }
        .sidebar-btn:hover { background: rgba(255,255,255,0.06) !important; }
        .sidebar-resize-handle:hover { background: rgba(255,255,255,0.14); }
      `}</style>

      {/* Everything except the bottom actions lives in one scroll container:
          overflow-y auto means the scrollbar pops in only when the sections
          (given their expanded/collapsed state) don't fit the window. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>

      {/* Primary actions (formerly the icon rail) */}
      <div style={{ padding: '4px', borderBottom: '1px solid #2d2d2d' }}>
        {!collapsed && (
          <button onClick={toggleActions} style={sectionHeadingStyle} className="sidebar-btn">
            <span>ACTIONS</span>
            {actionsExpanded ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
          </button>
        )}
        {(collapsed || actionsExpanded) && (<>
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
        </>)}
      </div>

      {/* Active terminals */}
      {terminals.length > 0 && (
      <div style={{ padding: '4px' }}>
        {!collapsed && (
          <button onClick={toggleActive} style={sectionHeadingStyle} className="sidebar-btn">
            <span>ACTIVE</span>
            {activeExpanded ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
          </button>
        )}
        {(collapsed || activeExpanded) && [...terminals].sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
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
              style={btnStyle(isActive)}
              className="sidebar-btn"
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
      )}

      {/* Favorites and Recent subsections. Open projects live in the ACTIVE
          section above, so they're filtered out here and "move back" when
          their terminals close. */}
      {!collapsed && recentFolders.length > 0 && (() => {
        const favSet = new Set(favoriteFolders)
        const closedFolders = recentFolders.filter((f) => !activePaths.has(f.path))
        const favorites = closedFolders.filter((f) => favSet.has(f.path)).sort((a, b) => a.name.localeCompare(b.name))
        const recents = closedFolders.filter((f) => !favSet.has(f.path)).sort((a, b) => b.lastOpened - a.lastOpened)
        return (
          <div>
            {favorites.length > 0 && (
              <div style={{ borderTop: '1px solid #2d2d2d' }}>
                <button
                  onClick={toggleFavorites}
                  style={sectionHeadingStyle}
                  className="sidebar-btn"
                >
                  <span>FAVORITES</span>
                  {favoritesExpanded ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
                </button>
                {favoritesExpanded && favorites.map((f) => (
                  <RecentRow
                    key={f.path}
                    folder={f}
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
              <div style={{ borderTop: '1px solid #2d2d2d' }}>
                <button
                  onClick={toggleRecent}
                  style={sectionHeadingStyle}
                  className="sidebar-btn"
                >
                  <span>RECENT</span>
                  {recentExpanded ? <ChevronDown width={12} height={12} /> : <ChevronRight width={12} height={12} />}
                </button>
                {recentExpanded && recents.map((f) => (
                  <RecentRow
                    key={f.path}
                    folder={f}
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

      </div>

      {/* Bottom actions */}
      <div style={{ padding: '6px 4px', borderTop: '1px solid #2d2d2d', flexShrink: 0 }}>
        <button onClick={onShowAll} style={btnStyle(viewMode.type === 'grid')} className="sidebar-btn" title="Show All">
          <LayoutGrid width={14} height={14} />
          {!collapsed && <span>Show All</span>}
        </button>
        {terminals.length > 0 && (
          <button onClick={onCloseAll} style={btnStyle()} className="sidebar-btn" title="Close All">
            <X width={14} height={14} style={{ color: '#f14c4c' }} />
            {!collapsed && <span>Close All</span>}
          </button>
        )}
        <button onClick={onOpenSettings} style={btnStyle()} className="sidebar-btn" title="Settings">
          <span style={{ color: '#aaa', display: 'flex', flexShrink: 0 }}><Settings width={14} height={14} /></span>
          {!collapsed && <span>Settings</span>}
        </button>
        <button onClick={toggleCollapsed} style={btnStyle()} className="sidebar-btn" title={collapsed ? 'Expand' : 'Collapse'}>
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
