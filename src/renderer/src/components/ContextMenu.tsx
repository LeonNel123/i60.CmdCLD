// src/renderer/src/components/ContextMenu.tsx
import { useEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  onClick?: () => void
  submenu?: ContextMenuItem[]
  separator?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export interface WindowInfo {
  id: string
  label: string
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') { onClose(); return }
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [onClose])

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    background: '#1a1a2e',
    border: '1px solid #333',
    borderRadius: '6px',
    padding: '4px 0',
    minWidth: '160px',
    zIndex: 2000,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  }

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    background: 'none',
    border: 'none',
    color: '#ccc',
    fontSize: '12px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    textAlign: 'left',
  }

  return (
    <div ref={ref} style={menuStyle}>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: '1px', background: '#333', margin: '4px 0' }} />
        }
        if (item.submenu) {
          return <SubmenuItem key={i} item={item} itemStyle={itemStyle} />
        }
        return (
          <button
            key={i}
            style={itemStyle}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
            onClick={() => { item.onClick?.(); }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function SubmenuItem({ item, itemStyle }: { item: ContextMenuItem; itemStyle: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        style={{ ...itemStyle, display: 'flex', justifyContent: 'space-between' }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
      >
        <span>{item.label}</span>
        <span style={{ marginLeft: '8px' }}>{'\u25B6'}</span>
      </button>
      {open && item.submenu && (
        <div style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          background: '#1a1a2e',
          border: '1px solid #333',
          borderRadius: '6px',
          padding: '4px 0',
          minWidth: '140px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {item.submenu.map((sub, i) => (
            <button
              key={i}
              style={itemStyle}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
              onClick={() => sub.onClick?.()}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Helper to build context menu items for a terminal
export function buildTerminalMenuItems(
  terminalId: string,
  folderPath: string,
  otherWindows: WindowInfo[],
  onMove: (terminalId: string, targetWindowId: string) => void,
  onOpenVscode: (path: string) => void,
): ContextMenuItem[] {
  const moveSubmenu: ContextMenuItem[] = [
    { label: 'New Window', onClick: () => onMove(terminalId, 'new') },
    ...otherWindows.map((w) => ({
      label: w.label,
      onClick: () => onMove(terminalId, w.id),
    })),
  ]

  return [
    { label: 'Move to', submenu: moveSubmenu },
    { separator: true },
    { label: 'Open in VS Code', onClick: () => onOpenVscode(folderPath) },
  ]
}
