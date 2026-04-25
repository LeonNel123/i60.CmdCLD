import { useEffect, useRef, useLayoutEffect, useState } from 'react'
import type { SVGProps } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: React.ComponentType<SVGProps<SVGSVGElement>>
  onClick: () => void
  disabled?: boolean
  divider?: boolean
  destructive?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y })

  // Clamp the menu to the viewport so it doesn't overflow.
  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + rect.width > vw - 4) left = Math.max(4, vw - rect.width - 4)
    if (top + rect.height > vh - 4) top = Math.max(4, vh - rect.height - 4)
    setPosition({ left, top })
  }, [x, y])

  // Close on outside click and Esc key.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        background: '#1a1a2e',
        border: '1px solid #2d2d2d',
        borderRadius: '6px',
        padding: '4px',
        minWidth: '200px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        zIndex: 4000,
        fontSize: '12px',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={`d-${i}`} style={{ height: '1px', background: '#2d2d2d', margin: '4px 2px' }} />
        }
        const Icon = item.icon
        return (
          <button
            key={item.label}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            disabled={item.disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '6px 10px',
              background: 'none',
              border: 'none',
              borderRadius: '3px',
              color: item.disabled ? '#555' : item.destructive ? '#f87171' : '#ccc',
              cursor: item.disabled ? 'default' : 'pointer',
              fontSize: '12px',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
            }}
          >
            {Icon ? <Icon width={14} height={14} style={{ flexShrink: 0 }} /> : <span style={{ width: 14 }} />}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
