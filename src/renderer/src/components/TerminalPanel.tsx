import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
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
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(termRef.current)

    // Make file paths clickable — opens in configured editor
    term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const links: Array<{ startIndex: number; length: number; text: string }> = []

        // Match Windows paths like C:\foo\bar.ts or C:\foo\bar.ts:42
        // Match relative paths like src/main/index.ts or ./foo/bar.js:10:5
        const pathRegex = /(?:[A-Z]:\\[\w\\.-]+(?::\d+)?|(?:\.\/|\.\.\/|[\w][\w/.-]*\/[\w.-]+)(?::\d+(?::\d+)?)?)/gi
        let match
        while ((match = pathRegex.exec(text)) !== null) {
          links.push({
            startIndex: match.index,
            length: match[0].length,
            text: match[0],
          })
        }

        callback(links.map((l) => ({
          range: {
            start: { x: l.startIndex + 1, y: bufferLineNumber },
            end: { x: l.startIndex + l.length + 1, y: bufferLineNumber },
          },
          text: l.text,
          activate() {
            // Strip line:col suffix for the editor open
            const filePart = l.text.replace(/:\d+(:\d+)?$/, '')
            window.api.openInEditor(filePart)
          },
        })))
      },
    })

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Track if Claude was launched so we can clear after it exits
    let claudeLaunched = false
    let waitingForPromptAfterExit = false

    // Register IPC listeners BEFORE creating PTY to avoid missing early data
    const removeData = window.api.onTerminalData(id, (data) => {
      term.write(data)
      onTerminalDataReceived(id)

      // Detect Claude exit: when Claude quits, the shell prompt returns.
      // Look for the PS prompt pattern after Claude was running.
      if (!isPlainShell && claudeLaunched && !waitingForPromptAfterExit) {
        // Claude outputs "Goodbye!" or similar on exit
        if (data.includes('Goodbye') || data.includes('See ya') || data.includes('Bye!') || data.includes('Catch you later')) {
          waitingForPromptAfterExit = true
          // Wait briefly for shell prompt to appear, then clear
          setTimeout(() => {
            term.clear()
            waitingForPromptAfterExit = false
          }, 500)
        }
      }
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
            claudeLaunched = true
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

  const actionBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#999',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '2px 6px',
    lineHeight: 1,
    fontFamily: 'monospace',
    borderRadius: '3px',
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
      <div style={{
        background: '#252526',
        display: 'flex',
        alignItems: 'center',
        borderBottom: `1px solid ${color}60`,
        borderLeft: `2px solid ${color}`,
        flexShrink: 0,
        height: '28px',
      }}>
        {/* Col 1: Folder name — drag handle */}
        <div
          className="drag-handle"
          style={{
            flex: 1,
            padding: '0 10px',
            cursor: 'grab',
            overflow: 'hidden',
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
        </div>

        {/* Col 2: Quick actions — click to execute, right-click for context menu */}
        <div
          onContextMenu={handleContextMenu}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1px',
            padding: '0 4px',
            borderLeft: '1px solid #333',
            borderRight: '1px solid #333',
            height: '100%',
          }}
        >
          {!isPlainShell && onSpawnShell && (
            <button
              onClick={onSpawnShell}
              onMouseDown={(e) => e.stopPropagation()}
              title="Open shell"
              style={actionBtnStyle}
            >
              &gt;_
            </button>
          )}
          <button
            onClick={() => window.api.openInEditor(folderPath)}
            onMouseDown={(e) => e.stopPropagation()}
            title={`Open in ${editorName}`}
            style={actionBtnStyle}
          >
            &#9998;
          </button>
          <button
            onClick={() => window.api.openInExplorer(folderPath)}
            onMouseDown={(e) => e.stopPropagation()}
            title="Open in Explorer"
            style={actionBtnStyle}
          >
            &#128193;
          </button>
        </div>

        {/* Col 3: Close */}
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          title="Close terminal"
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '13px',
            padding: '0 8px',
            lineHeight: 1,
            height: '100%',
          }}
        >
          &#10005;
        </button>
      </div>
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />

      {contextMenu && availableEditors.length > 1 && (
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
            minWidth: '150px',
            zIndex: 2000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {availableEditors.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                window.api.editorSetCurrent(e.cmd)
                setEditorName(e.name)
                setContextMenu(null)
              }}
              style={menuItemStyle}
              onMouseEnter={menuHoverIn}
              onMouseLeave={menuHoverOut}
            >
              {e.name} {e.cmd === editorName ? '' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
