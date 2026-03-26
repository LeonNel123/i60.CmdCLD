// src/renderer/src/components/TerminalPanel.tsx
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ContextMenu, buildTerminalMenuItems } from './ContextMenu'
import type { WindowInfo } from '../types/api'

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  onClose: () => void
  windowList: WindowInfo[]
  onMove: (terminalId: string, targetWindowId: string) => void
  initialScrollback?: string
  skipAutoLaunch?: boolean
}

export function TerminalPanel({
  id,
  folderPath,
  folderName,
  color,
  onClose,
  windowList,
  onMove,
  initialScrollback,
  skipAutoLaunch,
}: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [popoutOpen, setPopoutOpen] = useState(false)
  const popoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#0d1117' },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    requestAnimationFrame(() => {
      fitAddon.fit()

      // Write scrollback if this terminal was moved from another window
      if (initialScrollback) {
        term.write(initialScrollback)
      }

      // Create PTY and connect
      window.api.createTerminal(id, folderPath)

      const removeData = window.api.onTerminalData(id, (data) => {
        term.write(data)
      })

      const removeExit = window.api.onTerminalExit(id, (code) => {
        term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`)
      })

      term.onData((data) => {
        window.api.writeTerminal(id, data)
      })

      // Enable Ctrl+V paste from clipboard
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
          navigator.clipboard.readText().then((text) => {
            if (text) window.api.writeTerminal(id, text)
          })
          return false
        }
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection())
          return false
        }
        return true
      })

      // Auto-launch Claude after shell is ready
      if (!skipAutoLaunch) {
        setTimeout(() => {
          window.api.writeTerminal(id, 'claude --dangerously-skip-permissions\r')
        }, 1000)
      }

      ;(term as any)._cmdcld_cleanup = { removeData, removeExit }
    })

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
        const { cols, rows } = terminalRef.current
        window.api.resizeTerminal(id, cols, rows)
      }
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      const cleanup = (term as any)._cmdcld_cleanup
      if (cleanup) {
        cleanup.removeData()
        cleanup.removeExit()
      }
      term.dispose()
      window.api.killTerminal(id)
    }
  }, [id, folderPath])

  // Close popout dropdown on outside click
  useEffect(() => {
    if (!popoutOpen) return
    const handler = (e: MouseEvent) => {
      if (popoutRef.current && !popoutRef.current.contains(e.target as Node)) {
        setPopoutOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoutOpen])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handlePopout = () => {
    if (windowList.length === 0) {
      onMove(id, 'new')
    } else {
      setPopoutOpen(!popoutOpen)
    }
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      border: `2px solid ${color}`,
      borderRadius: '4px',
      overflow: 'hidden',
    }}>
      <div
        className="drag-handle"
        onContextMenu={handleContextMenu}
        style={{
          background: `${color}20`,
          padding: '4px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color}`,
          cursor: 'grab',
          flexShrink: 0,
        }}
      >
        <span style={{
          color,
          fontSize: '12px',
          fontFamily: 'monospace',
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {folderName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
          {/* Pop-out button */}
          <button
            onClick={handlePopout}
            onMouseDown={(e) => e.stopPropagation()}
            title="Move to another window"
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &#10697;
          </button>
          {/* Pop-out dropdown */}
          {popoutOpen && (
            <div ref={popoutRef} style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: '#1a1a2e',
              border: '1px solid #333',
              borderRadius: '6px',
              padding: '4px 0',
              minWidth: '120px',
              zIndex: 2000,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <button
                onClick={() => { onMove(id, 'new'); setPopoutOpen(false) }}
                style={{
                  display: 'block', width: '100%', padding: '6px 12px',
                  background: 'none', border: 'none', color: '#ccc',
                  fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left',
                }}
              >
                New Window
              </button>
              {windowList.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { onMove(id, w.id); setPopoutOpen(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '6px 12px',
                    background: 'none', border: 'none', color: '#ccc',
                    fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
          {/* Close button */}
          <button
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &#10005;
          </button>
        </div>
      </div>
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildTerminalMenuItems(
            id,
            folderPath,
            windowList,
            (tid, wid) => { onMove(tid, wid); setContextMenu(null) },
            (path) => { window.api.openInVscode(path); setContextMenu(null) },
          )}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
