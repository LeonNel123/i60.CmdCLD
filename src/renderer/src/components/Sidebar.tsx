import { useState, memo } from 'react'
import type { RecentFolder } from '../types/api'
import { formatRelativeTime } from '../utils/format-relative-time'
import { ChevronLeft, ChevronRight, ChevronDown, Star, X, LayoutGrid } from './icons'

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
}

const EXPANDED_WIDTH = 180
const COLLAPSED_WIDTH = 36

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
        gap: '6px',
        width: '100%',
        padding: '6px 10px',
        background: 'none',
        cursor: isOpen ? 'default' : 'pointer',
        opacity: isOpen ? 0.5 : 1,
        fontFamily: 'inherit',
        fontSize: '12px',
        borderRadius: '3px',
      }}
      title={isOpen ? `${folder.path} (already open)` : folder.path}
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

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
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
        .recent-row:hover { background: rgba(255,255,255,0.06); }
        .sidebar-btn:hover { background: rgba(255,255,255,0.06) !important; }
      `}</style>
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

      {/* Favorites and Recent subsections */}
      {!collapsed && recentFolders.length > 0 && (() => {
        const favSet = new Set(favoriteFolders)
        const favorites = recentFolders.filter((f) => favSet.has(f.path)).sort((a, b) => a.name.localeCompare(b.name))
        const recents = recentFolders.filter((f) => !favSet.has(f.path)).sort((a, b) => b.lastOpened - a.lastOpened)
        return (
          <div style={{ flex: 1, overflowY: 'auto' }}>
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
        <button onClick={toggleCollapsed} style={btnStyle()} className="sidebar-btn" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight width={14} height={14} /> : <ChevronLeft width={14} height={14} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}
