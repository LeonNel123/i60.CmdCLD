import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  onClose: () => void
}

export function TerminalPanel({ id, folderPath, folderName, color, onClose }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

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

    // Small delay to ensure the container has dimensions before fitting
    requestAnimationFrame(() => {
      fitAddon.fit()

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

      // Auto-launch Claude after shell is ready
      setTimeout(() => {
        window.api.writeTerminal(id, 'claude --dangerously-skip-permissions\r')
      }, 1000)

      // Store cleanup references on the terminal instance for the cleanup function
      ;(term as any)._cmdcld_cleanup = { removeData, removeExit }
    })

    // Resize observer to fit terminal when panel resizes
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
          ✕
        </button>
      </div>
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
