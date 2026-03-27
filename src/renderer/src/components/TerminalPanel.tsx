import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { onTerminalDataReceived, removeTerminalActivity } from '../utils/terminal-activity'

// Global set of PTY IDs that have been created — prevents duplicates on remount
const activePtys = new Set<string>()

// Kill a PTY explicitly (called from App.tsx on confirmed close)
export function killPty(id: string): void {
  activePtys.delete(id)
  removeTerminalActivity(id)
  window.api.killTerminal(id)
}

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  claudeArgs?: string
  isPlainShell?: boolean
  onClose: () => void
  onSpawnShell?: () => void
}

export function TerminalPanel({
  id,
  folderPath,
  folderName,
  color,
  claudeArgs,
  isPlainShell,
  onClose,
  onSpawnShell,
}: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<{ removeData: () => void; removeExit: () => void; removePaste: () => void } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [editorName, setEditorName] = useState('Editor')
  const [availableEditors, setAvailableEditors] = useState<Array<{ id: string; name: string; cmd: string }>>([])
  const [showEditorPicker, setShowEditorPicker] = useState(false)

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
      fontSize: 13,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Register IPC listeners BEFORE creating PTY to avoid missing early data
    const removeData = window.api.onTerminalData(id, (data) => {
      term.write(data)
      onTerminalDataReceived(id)
    })

    const removeExit = window.api.onTerminalExit(id, (code) => {
      term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`)
      activePtys.delete(id)
    })

    const removePaste = () => {
      if (xtermTextarea) xtermTextarea.removeEventListener('paste', blockNativePaste, true)
    }
    cleanupRef.current = { removeData, removeExit, removePaste }

    term.onData((data) => {
      window.api.writeTerminal(id, data)
    })

    // Block xterm's internal paste handler on its hidden textarea
    // This is the root cause of double-paste: our key handler writes text,
    // AND xterm's native paste listener on its textarea also writes text via onData
    const xtermTextarea = termRef.current!.querySelector('textarea')
    const blockNativePaste = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (xtermTextarea) {
      xtermTextarea.addEventListener('paste', blockNativePaste, true)
    }

    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+C: copy selection
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }
      // Ctrl+V: custom paste with image support
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        window.api.clipboardSaveImage(folderPath).then((imgPath) => {
          if (imgPath) {
            window.api.writeTerminal(id, imgPath)
          } else {
            return navigator.clipboard.readText().then((text) => {
              if (text) window.api.writeTerminal(id, text)
            })
          }
        }).catch(() => {})
        return false
      }
      // Block keyup for Ctrl+V too
      if (e.type === 'keyup' && e.ctrlKey && e.key === 'v') {
        return false
      }
      return true
    })

    // Fit and create PTY after layout is ready
    requestAnimationFrame(() => {
      fitAddon.fit()

      if (!activePtys.has(id)) {
        activePtys.add(id)
        window.api.createTerminal(id, folderPath).catch(() => {
          term.write('\r\n\x1b[31m[Failed to create terminal]\x1b[0m\r\n')
          activePtys.delete(id)
        })

        if (!isPlainShell) {
          const launchCmd = claudeArgs ? `claude ${claudeArgs}\r` : 'claude\r'
          setTimeout(() => {
            window.api.writeTerminal(id, launchCmd)
          }, 1000)
        }
      }
    })

    // Debounced resize observer
    let resizeTimer: ReturnType<typeof setTimeout>
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          window.api.resizeTerminal(id, cols, rows)
        }
      }, 100)
    })
    resizeObserver.observe(termRef.current)

    return () => {
      clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      if (cleanupRef.current) {
        cleanupRef.current.removeData()
        cleanupRef.current.removeExit()
        cleanupRef.current.removePaste()
        cleanupRef.current = null
      }
      term.dispose()
      // Do NOT kill PTY here — only kill on explicit close via killPty()
    }
  }, [id, folderPath])

  // Load editor info once
  useEffect(() => {
    Promise.all([
      window.api.editorGetAvailable(),
      window.api.editorGetCurrent(),
    ]).then(([editors, current]) => {
      setAvailableEditors(editors)
      const found = editors.find((e) => e.cmd === current)
      setEditorName(found?.name || 'Editor')
    }).catch(() => {})
  }, [])

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
    setShowEditorPicker(false)
  }

  const menuItemStyle: React.CSSProperties = {
    display: 'block', width: '100%', padding: '6px 12px',
    background: 'none', border: 'none', color: '#ccc',
    fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left',
  }
  const menuHoverIn = (e: React.MouseEvent) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }
  const menuHoverOut = (e: React.MouseEvent) => { (e.target as HTMLElement).style.background = 'none' }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${color}40`,
      borderRadius: '4px',
      overflow: 'hidden',
      background: '#1e1e1e',
    }}>
      <div
        className="drag-handle"
        onContextMenu={handleContextMenu}
        style={{
          background: '#252526',
          padding: '3px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color}60`,
          borderLeft: `2px solid ${color}`,
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
          {isPlainShell && (
            <span style={{ color: '#888', fontSize: '10px', marginLeft: '6px', fontWeight: 400 }}>
              shell
            </span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {/* Spawn plain shell button — only show on Claude terminals */}
          {!isPlainShell && onSpawnShell && (
            <button
              onClick={onSpawnShell}
              onMouseDown={(e) => e.stopPropagation()}
              title="Open shell for this folder"
              style={{
                background: '#ffffff10',
                border: '1px solid #ffffff20',
                borderRadius: '3px',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '1px 5px',
                lineHeight: 1,
                fontFamily: 'monospace',
              }}
            >
              &gt;_
            </button>
          )}
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

      {contextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: '6px',
            padding: '4px 0',
            minWidth: '180px',
            zIndex: 2000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <button
            onClick={() => {
              window.api.openInEditor(folderPath)
              setContextMenu(null)
            }}
            style={menuItemStyle}
            onMouseEnter={menuHoverIn}
            onMouseLeave={menuHoverOut}
          >
            Open in {editorName}
          </button>
          {availableEditors.length > 1 && (
            <>
              <div style={{ height: '1px', background: '#333', margin: '4px 0' }} />
              <div
                style={{ position: 'relative' }}
                onMouseEnter={() => setShowEditorPicker(true)}
                onMouseLeave={() => setShowEditorPicker(false)}
              >
                <button
                  style={{ ...menuItemStyle, display: 'flex', justifyContent: 'space-between' }}
                  onMouseEnter={menuHoverIn}
                  onMouseLeave={menuHoverOut}
                >
                  <span>Change Editor</span>
                  <span style={{ fontSize: '10px' }}>{'\u25B6'}</span>
                </button>
                {showEditorPicker && (
                  <div style={{
                    position: 'absolute',
                    left: '100%',
                    top: 0,
                    background: '#1a1a2e',
                    border: '1px solid #333',
                    borderRadius: '6px',
                    padding: '4px 0',
                    minWidth: '150px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  }}>
                    {availableEditors.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          window.api.editorSetCurrent(e.cmd)
                          setEditorName(e.name)
                          setContextMenu(null)
                          setShowEditorPicker(false)
                        }}
                        style={menuItemStyle}
                        onMouseEnter={menuHoverIn}
                        onMouseLeave={menuHoverOut}
                      >
                        {e.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
