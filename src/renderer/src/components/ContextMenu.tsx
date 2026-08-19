import { useEffect, useRef, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SVGProps } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: React.ComponentType<SVGProps<SVGSVGElement>>
  onClick: () => void
  disabled?: boolean
  divider?: boolean
  destructive?: boolean
  /** A hover flyout of sub-items (one level). The parent row itself is inert. */
  submenu?: ContextMenuItem[]
  /** Shows a trailing ✓ (e.g. the current default). */
  checked?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

// The menu carries .ui-scaled (CSS zoom — the terminal-matched chrome scale,
// since menu text sits on the same 12px grid as the sidebar), which multiplies
// its own left/top. Positions are computed in real viewport pixels, then
// divided by the scale so the rendered menu lands exactly at the cursor at any
// interface scale.
function uiScale(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'))
  return Number.isFinite(v) && v > 0 ? v : 1
}

const PANEL_STYLE: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #2d2d2d',
  borderRadius: '6px',
  padding: '4px',
  minWidth: '200px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  fontSize: '12px',
}

function MenuButton({ item, onActivate }: { item: ContextMenuItem; onActivate: () => void }) {
  const Icon = item.icon
  const hasSub = !!item.submenu?.length
  return (
    <button
      onClick={() => { if (!item.disabled && !hasSub) onActivate() }}
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
        cursor: item.disabled || hasSub ? 'default' : 'pointer',
        fontSize: '12px',
        fontFamily: 'inherit',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      {Icon ? <Icon width={14} height={14} style={{ flexShrink: 0 }} /> : <span style={{ width: 14, flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.checked && <span style={{ color: '#22c55e', flexShrink: 0 }}>✓</span>}
      {hasSub && <span style={{ color: '#777', flexShrink: 0 }}>▸</span>}
    </button>
  )
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [openSub, setOpenSub] = useState<number | null>(null)
  // Whether submenu flyouts open to the left (when there's no room to the right).
  const [openLeft, setOpenLeft] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x / uiScale(), top: y / uiScale() })

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
    const scale = uiScale()
    setPosition({ left: left / scale, top: top / scale })
    // A submenu is about as wide as the menu; if that wouldn't fit to the right
    // of the clamped menu, open flyouts leftward instead so they stay on-screen.
    setOpenLeft(left + rect.width + rect.width > vw - 4)
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

  // Portal to <body>: rendered in place, position:fixed would resolve against
  // the nearest transformed ancestor (react-grid-layout transforms every panel),
  // landing the menu off-panel where overflow:hidden clips it. At <body> there is
  // no transform, so fixed positioning is relative to the viewport as intended.
  return createPortal(
    <div
      ref={ref}
      className="ui-scaled"
      style={{ ...PANEL_STYLE, position: 'fixed', left: position.left, top: position.top, zIndex: 4000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={`d-${i}`} style={{ height: '1px', background: '#2d2d2d', margin: '4px 2px' }} />
        }
        const hasSub = !!item.submenu?.length
        return (
          <div
            key={item.label}
            style={{ position: 'relative' }}
            onMouseEnter={() => hasSub && setOpenSub(i)}
            onMouseLeave={() => hasSub && setOpenSub((cur) => (cur === i ? null : cur))}
          >
            <MenuButton item={item} onActivate={() => { item.onClick(); onClose() }} />
            {hasSub && openSub === i && (
              <div style={{ position: 'absolute', top: 0, zIndex: 1, ...(openLeft ? { right: '100%', paddingRight: '2px' } : { left: '100%', paddingLeft: '2px' }) }}>
                <div style={PANEL_STYLE}>
                  {item.submenu!.map((sub, si) => sub.divider
                    ? <div key={`sd-${si}`} style={{ height: '1px', background: '#2d2d2d', margin: '4px 2px' }} />
                    : <MenuButton key={sub.label} item={sub} onActivate={() => { sub.onClick(); onClose() }} />
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
