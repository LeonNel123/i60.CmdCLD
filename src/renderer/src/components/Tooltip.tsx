import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'

interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'right' | 'top' | 'bottom' | 'left'
  delayMs?: number
}

export function Tooltip({ label, children, side = 'right', delayMs = 150 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(true), delayMs)
  }
  const onLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return
    const t = triggerRef.current.getBoundingClientRect()
    const tip = tooltipRef.current.getBoundingClientRect()
    const gap = 8
    let left = 0
    let top = 0
    if (side === 'right') {
      left = t.right + gap
      top = t.top + (t.height - tip.height) / 2
    } else if (side === 'left') {
      left = t.left - tip.width - gap
      top = t.top + (t.height - tip.height) / 2
    } else if (side === 'top') {
      left = t.left + (t.width - tip.width) / 2
      top = t.top - tip.height - gap
    } else {
      left = t.left + (t.width - tip.width) / 2
      top = t.bottom + gap
    }
    // Clamp to viewport
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (left + tip.width > vw - 4) left = Math.max(4, vw - tip.width - 4)
    if (left < 4) left = 4
    if (top + tip.height > vh - 4) top = Math.max(4, vh - tip.height - 4)
    if (top < 4) top = 4
    setPos({ left, top })
  }, [visible, side])

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{ display: 'contents' }}
      >
        {children}
      </span>
      {visible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            background: '#1f1f2e',
            color: '#e0e0e0',
            border: '1px solid #2d2d2d',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 5000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          {label}
        </div>
      )}
    </>
  )
}
