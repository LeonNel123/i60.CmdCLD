import { useState, useEffect, useMemo, useRef } from 'react'
import type { RecentFolder } from '../types/api'
import { Star } from './icons'
import { formatRelativeTime } from '../utils/format-relative-time'

interface CommandPaletteProps {
  recentFolders: RecentFolder[]
  favoriteFolders: string[]
  onOpen: (path: string) => void
  onClose: () => void
}

// Simple fuzzy scorer: substring match scores higher than character-sequence match.
// Both case-insensitive. Returns 0 for no match, higher score = better.
function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  if (text.includes(query)) return 100 + (text.startsWith(query) ? 50 : 0)
  let qi = 0
  let score = 0
  let consecutive = 0
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      score += 1 + consecutive
      consecutive++
      qi++
    } else {
      consecutive = 0
    }
  }
  return qi === query.length ? score : 0
}

export function CommandPalette({ recentFolders, favoriteFolders, onOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const favSet = new Set(favoriteFolders)
    const all = recentFolders.map((f) => ({ ...f, isFav: favSet.has(f.path) }))
    if (!query.trim()) {
      return all.sort((a, b) => {
        if (a.isFav !== b.isFav) return a.isFav ? -1 : 1
        return b.lastOpened - a.lastOpened
      }).slice(0, 50)
    }
    const q = query.trim().toLowerCase()
    return all
      .map((item) => ({ item, score: fuzzyScore(item.name.toLowerCase(), q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        // Favorites edge out non-favorites at equal score
        if (a.score !== b.score) return b.score - a.score
        if (a.item.isFav !== b.item.isFav) return a.item.isFav ? -1 : 1
        return b.item.lastOpened - a.item.lastOpened
      })
      .slice(0, 50)
      .map(({ item }) => item)
  }, [query, recentFolders, favoriteFolders])

  useEffect(() => { setSelectedIdx(0) }, [query])

  // Keep selected row in view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  // Keyboard handling — captured at window level so it always works while palette is mounted
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[selectedIdx]
        if (item) {
          onOpen(item.path)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selectedIdx, onOpen, onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 5000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a2e',
          border: '1px solid #333',
          borderRadius: 8,
          width: 520,
          maxWidth: '90%',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          fontFamily: 'inherit',
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search projects…"
          style={{
            background: 'none',
            border: 'none',
            borderBottom: '1px solid #333',
            padding: '14px 16px',
            color: '#e0e0e0',
            fontSize: 14,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <div ref={listRef} style={{ overflowY: 'auto', padding: 4 }}>
          {items.length === 0 && (
            <div style={{ padding: 16, color: '#666', fontSize: 12, textAlign: 'center' }}>
              No matches
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={item.path}
              onClick={() => { onOpen(item.path); onClose() }}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 4,
                background: i === selectedIdx ? 'rgba(255,255,255,0.08)' : 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#ccc',
              }}
            >
              <Star
                width={12}
                height={12}
                fill={item.isFav ? 'currentColor' : 'none'}
                style={{ color: item.isFav ? '#fbbf24' : '#444', flexShrink: 0 }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              <span style={{ color: '#666', fontSize: 10, fontFamily: 'Menlo, Consolas, monospace' }}>
                {formatRelativeTime(item.lastOpened)}
              </span>
            </div>
          ))}
        </div>
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid #2d2d2d',
          color: '#555',
          fontSize: 10,
          display: 'flex',
          gap: 14,
        }}>
          <span><span style={{ color: '#888' }}>↑↓</span> navigate</span>
          <span><span style={{ color: '#888' }}>↵</span> open</span>
          <span><span style={{ color: '#888' }}>esc</span> close</span>
        </div>
      </div>
    </div>
  )
}
