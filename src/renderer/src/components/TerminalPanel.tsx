import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Global set of PTY IDs that have been created — prevents duplicates on remount
const activePtys = new Set<string>()

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  onClose: () => void
}

export function TerminalPanel({
  id,
  folderPath,
  folderName,
  color,
  onClose,
}: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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

      // Only create the PTY if it doesn't already exist
      if (!activePtys.has(id)) {
        activePtys.add(id)
        window.api.createTerminal(id, folderPath).catch(() => {
          term.write('\r\n\x1b[31m[Failed to create terminal]\x1b[0m\r\n')
          activePtys.delete(id)
        })

        // Auto-launch Claude only on first create
        setTimeout(() => {
          window.api.writeTerminal(id, 'claude --dangerously-skip-permissions\r')
        }, 1000)
      }

      const removeData = window.api.onTerminalData(id, (data) => {
        term.write(data)
      })

      const removeExit = window.api.onTerminalExit(id, (code) => {
        term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`)
        activePtys.delete(id)
      })

      term.onData((data) => {
        window.api.writeTerminal(id, data)
      })

      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
          navigator.clipboard.readText().then((text) => {
            if (text) window.api.writeTerminal(id, text)
          }).catch(() => {})
          return false
        }
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {})
          return false
        }
        return true
      })

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
      // Do NOT kill the PTY here — only kill on explicit close via killTerminal()
    }
  }, [id, folderPath])

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') { setContextMenu(null); return }
      if (e instanceof MouseEvent) setContextMenu(null)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleClose = () => {
    // Explicitly kill the PTY only when the user closes the terminal
    activePtys.delete(id)
    window.api.killTerminal(id)
    onClose()
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
        <button
          onClick={handleClose}
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
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />

      {contextMenu && (
        <div style={{
          position: 'fixed',
          left: contextMenu.x,
          top: contextMenu.y,
          background: '#1a1a2e',
          border: '1px solid #333',
          borderRadius: '6px',
          padding: '4px 0',
          minWidth: '160px',
          zIndex: 2000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              window.api.openInVscode(folderPath)
              setContextMenu(null)
            }}
            style={{
              display: 'block', width: '100%', padding: '6px 12px',
              background: 'none', border: 'none', color: '#ccc',
              fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
          >
            Open in VS Code
          </button>
        </div>
      )}
    </div>
  )
}
