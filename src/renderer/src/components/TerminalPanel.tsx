import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { onTerminalDataReceived, removeTerminalActivity } from '../utils/terminal-activity'
import { formatPaths } from '../utils/format-paths'

// Global set of PTY IDs that have been created — prevents duplicates on remount
const activePtys = new Set<string>()

// Write text to PTY. Small writes go through as a single IPC call.
// Larger pastes are chunked with a tiny setTimeout delay between chunks
// so the PTY/conpty/Claude Code's prompt parser has time to drain each
// chunk before the next arrives — without pacing, Windows conpty
// silently dropped characters on long single-burst pastes.
const PASTE_CHUNK_SIZE = 1024 // bytes per chunk once we enter chunked mode
const PASTE_CHUNK_THRESHOLD = 1024 // pastes larger than this get paced
const PASTE_CHUNK_DELAY_MS = 5 // ~200 KB/s — faster than typing, below conpty's drop threshold

function writeChunked(id: string, text: string): void {
  if (text.length > PASTE_CHUNK_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.log(`[CmdCLD] paste size=${text.length} bytes → chunking @ ${PASTE_CHUNK_SIZE}B/${PASTE_CHUNK_DELAY_MS}ms`)
  }
  if (text.length <= PASTE_CHUNK_THRESHOLD) {
    window.api.writeTerminal(id, text)
    return
  }
  let offset = 0
  const writeNext = (): void => {
    if (offset >= text.length) return
    const chunk = text.slice(offset, offset + PASTE_CHUNK_SIZE)
    window.api.writeTerminal(id, chunk)
    offset += PASTE_CHUNK_SIZE
    setTimeout(writeNext, PASTE_CHUNK_DELAY_MS)
  }
  writeNext()
}

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
  onOpenMarkdown?: (filePath: string) => void
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
  onOpenMarkdown,
}: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const cleanupRef = useRef<{ removeData: () => void; removeExit: () => void; removePaste: () => void; removeResize: () => void; removeDragDrop: () => void } | null>(null)
  // Tracks the last dims we received from the PTY (via pty:resize events).
  // When the local ResizeObserver fires after a remote-driven resize, we
  // compare against this so we don't echo the remote's dims back and kick
  // them off the size. Only a *real* container change (different from the
  // PTY's current size) takes ownership.
  const ptyDimsRef = useRef<{ cols: number; rows: number } | null>(null)
  // Whether the program currently running in this PTY has enabled bracketed
  // paste mode (it sends \x1b[?2004h to enable, \x1b[?2004l to disable).
  // When true, our paste handler wraps the clipboard text with the paste
  // markers so the program treats the whole thing as one paste event
  // instead of executing each embedded newline as Enter.
  const bracketedPasteRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [editorName, setEditorName] = useState('Editor')
  const [availableEditors, setAvailableEditors] = useState<Array<{ id: string; name: string; cmd: string }>>([])
  const [showEditorPicker, setShowEditorPicker] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
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
      fontFamily: 'Cascadia Code, Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 13,
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.api.openExternal(uri)
    })
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(searchAddon)
    term.open(termRef.current)

    // Make file paths clickable — opens in configured editor
    term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const links: Array<{ startIndex: number; length: number; text: string }> = []
        // Match: Windows absolute paths, Unix absolute paths (not inside URLs), relative paths with / or \, and bare filenames with extensions
        const pathRegex = /(?:[A-Z]:\\[\w\\.-]+(?::\d+)?|(?<!\/)\/[\w./-]+(?::\d+(?::\d+)?)?|(?:\.[\\/]|\.\.[\\/]|[\w][\w/\\.-]*[\\/][\w.-]+)(?::\d+(?::\d+)?)?|[\w.-]+\.(?:md|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|py|rs|go|java|sh|sql|xml|csv|txt|log|env|cfg|ini|conf)(?::\d+(?::\d+)?)?)/gi
        let match
        while ((match = pathRegex.exec(text)) !== null) {
          links.push({ startIndex: match.index, length: match[0].length, text: match[0] })
        }
        callback(links.map((l) => ({
          range: {
            start: { x: l.startIndex + 1, y: bufferLineNumber },
            end: { x: l.startIndex + l.length + 1, y: bufferLineNumber },
          },
          text: l.text,
          activate() {
            let filePart = l.text.replace(/:\d+(:\d+)?$/, '')
            // Resolve bare filenames relative to the terminal's folder
            if (!filePart.includes('/') && !filePart.includes('\\')) {
              const sep = window.api.platform === 'win32' ? '\\' : '/'
              filePart = folderPath + sep + filePart
            }
            if (filePart.toLowerCase().endsWith('.md') && onOpenMarkdown) {
              onOpenMarkdown(filePart)
            } else {
              window.api.openInEditor(filePart)
            }
          },
        })))
      },
    })

    terminalRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    let claudeLaunched = false

    const removeData = window.api.onTerminalData(id, (data) => {
      // Sniff bracketed-paste mode toggles. A single chunk can in theory
      // contain both — the later one wins.
      const enableIdx = data.lastIndexOf('\x1b[?2004h')
      const disableIdx = data.lastIndexOf('\x1b[?2004l')
      if (enableIdx >= 0 || disableIdx >= 0) {
        bracketedPasteRef.current = enableIdx > disableIdx
      }
      term.write(data)
      onTerminalDataReceived(id)
    })

    const removeExit = window.api.onTerminalExit(id, (code) => {
      term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`)
      activePtys.delete(id)
    })

    // When another client (or our own fit) resizes the PTY, mirror the new
    // cols/rows into our xterm without touching the container. This keeps
    // wrapping correct when a remote web client drives the size.
    const removeResize = window.api.onTerminalResize(id, ({ cols, rows }) => {
      ptyDimsRef.current = { cols, rows }
      if (terminalRef.current && (terminalRef.current.cols !== cols || terminalRef.current.rows !== rows)) {
        try { terminalRef.current.resize(cols, rows) } catch {}
      }
    })

    const removePaste = () => {
      if (xtermTextarea) xtermTextarea.removeEventListener('paste', blockNativePaste, true)
    }

    // Drag-and-drop: forward dropped file paths into the PTY
    const container = termRef.current!
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setDragActive(true)
      }
    }
    const onDragLeave = (): void => setDragActive(false)
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      setDragActive(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f: any) => f.path as string).filter(Boolean)
      if (paths.length === 0) return
      const payload = bracketedPasteRef.current
        ? '\x1b[200~' + formatPaths(paths) + '\x1b[201~'
        : formatPaths(paths)
      writeChunked(id, payload)
    }
    container.addEventListener('dragover', onDragOver)
    container.addEventListener('dragleave', onDragLeave)
    container.addEventListener('drop', onDrop)
    const removeDragDrop = (): void => {
      container.removeEventListener('dragover', onDragOver)
      container.removeEventListener('dragleave', onDragLeave)
      container.removeEventListener('drop', onDrop)
    }

    cleanupRef.current = { removeData, removeExit, removePaste, removeResize, removeDragDrop }

    term.onData((data) => {
      window.api.writeTerminal(id, data)
    })

    // Block xterm's internal paste handler
    const xtermTextarea = termRef.current!.querySelector('textarea')
    const blockNativePaste = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (xtermTextarea) {
      xtermTextarea.addEventListener('paste', blockNativePaste, true)
    }

    // Use Cmd on macOS, Ctrl on Windows/Linux for terminal shortcuts
    const isMac = window.api.platform === 'darwin'
    const modKey = (e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && modKey(e) && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }
      if (e.type === 'keydown' && modKey(e) && e.key === 'v') {
        window.api.clipboardSaveImage(folderPath).then((imgPath) => {
          if (imgPath) {
            window.api.writeTerminal(id, imgPath)
            return
          }
          return window.api.clipboardReadFiles().then((files) => {
            if (files && files.length > 0) {
              window.api.writeTerminal(id, formatPaths(files))
              return
            }
            return navigator.clipboard.readText().then((text) => {
              if (!text) return
              const payload = bracketedPasteRef.current
                ? '\x1b[200~' + text + '\x1b[201~'
                : text
              writeChunked(id, payload)
            })
          })
        }).catch(() => {})
        return false
      }
      if (e.type === 'keyup' && modKey(e) && e.key === 'v') {
        return false
      }
      // Mod+F: open search
      if (e.type === 'keydown' && modKey(e) && e.key === 'f') {
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
        return false
      }
      // Mod+= / Mod+-: font zoom
      if (e.type === 'keydown' && modKey(e) && (e.key === '=' || e.key === '+')) {
        const newSize = Math.min(term.options.fontSize! + 1, 28)
        term.options.fontSize = newSize
        fitAddon.fit()
        return false
      }
      if (e.type === 'keydown' && modKey(e) && e.key === '-') {
        const newSize = Math.max(term.options.fontSize! - 1, 8)
        term.options.fontSize = newSize
        fitAddon.fit()
        return false
      }
      // Mod+0: reset font size
      if (e.type === 'keydown' && modKey(e) && e.key === '0') {
        term.options.fontSize = 13
        fitAddon.fit()
        return false
      }
      return true
    })

    // Fit and create PTY after layout is ready
    requestAnimationFrame(() => {
      fitAddon.fit()

      if (!activePtys.has(id)) {
        // First mount — create PTY and launch Claude
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
      } else {
        // Remount — PTY exists, replay scrollback to restore terminal content
        window.api.getScrollback(id).then((data) => {
          if (data) term.write(data)
        }).catch(() => {})
        claudeLaunched = true
      }
    })

    // Debounced resize observer — fires only when the container's actual
    // pixel dimensions change (sidebar toggle, window resize, font zoom).
    // We fit to our container and claim the PTY size, which broadcasts to
    // every other client. Remote-driven resizes come in via onTerminalResize
    // above and don't touch the container, so they don't retrigger this.
    let resizeTimer: ReturnType<typeof setTimeout>
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          // Skip the IPC round-trip if the PTY already matches (e.g. we
          // just absorbed a remote resize that set our xterm to these dims
          // and the container happened to fit the same size).
          const last = ptyDimsRef.current
          if (!last || last.cols !== cols || last.rows !== rows) {
            window.api.resizeTerminal(id, cols, rows)
          }
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
        cleanupRef.current.removeResize()
        cleanupRef.current.removeDragDrop()
        cleanupRef.current = null
      }
      term.dispose()
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

  const handleSearch = (query: string, direction: 'next' | 'prev' = 'next') => {
    if (!searchAddonRef.current || !query) return
    if (direction === 'next') {
      searchAddonRef.current.findNext(query)
    } else {
      searchAddonRef.current.findPrevious(query)
    }
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    searchAddonRef.current?.clearDecorations()
    terminalRef.current?.focus()
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

        {/* Col 2: Quick actions */}
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
            <button onClick={onSpawnShell} onMouseDown={(e) => e.stopPropagation()} title="Open shell" style={actionBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3l5 4-5 4V3zm6 8h6v1H8v-1z"/></svg>
            </button>
          )}
          <button onClick={() => window.api.openInEditor(folderPath)} onMouseDown={(e) => e.stopPropagation()} title={`Open in ${editorName}`} style={actionBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>
            </button>
          <button onClick={() => window.api.openInExplorer(folderPath)} onMouseDown={(e) => e.stopPropagation()} title={window.api.platform === 'darwin' ? 'Open in Finder' : 'Open in Explorer'} style={actionBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5l.5.5v10l-.5.5h-13l-.5-.5v-12l.5-.5zM2 13h12V4H7.06l-1-2H2v11z"/></svg>
          </button>
        </div>

        {/* Col 3: Close */}
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          title="Close terminal"
          style={{
            background: 'none', border: 'none', color: '#666',
            cursor: 'pointer', fontSize: '13px', padding: '0 8px',
            lineHeight: 1, height: '100%',
          }}
        >
          &#10005;
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '3px 8px', background: '#252526',
          borderBottom: '1px solid #333', flexShrink: 0,
        }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); handleSearch(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              if (e.key === 'Escape') closeSearch()
            }}
            placeholder="Search..."
            style={{
              flex: 1, background: '#1e1e1e', border: '1px solid #444',
              borderRadius: '3px', padding: '2px 6px', color: '#ccc',
              fontSize: '12px', fontFamily: 'monospace', outline: 'none',
            }}
          />
          <button onClick={() => handleSearch(searchQuery, 'prev')} style={{ ...actionBtnStyle, fontSize: '11px' }} title="Previous (Shift+Enter)">&#9650;</button>
          <button onClick={() => handleSearch(searchQuery, 'next')} style={{ ...actionBtnStyle, fontSize: '11px' }} title="Next (Enter)">&#9660;</button>
          <button onClick={closeSearch} style={{ ...actionBtnStyle, fontSize: '11px' }} title="Close (Esc)">&#10005;</button>
        </div>
      )}

      <div
        ref={termRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          boxShadow: dragActive ? 'inset 0 0 0 2px #22c55e' : undefined,
        }}
      />

      {contextMenu && availableEditors.length > 1 && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: '#1a1a2e', border: '1px solid #333', borderRadius: '6px',
            padding: '4px 0', minWidth: '150px', zIndex: 2000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {availableEditors.map((e) => (
            <button
              key={e.id}
              onClick={() => { window.api.editorSetCurrent(e.cmd); setEditorName(e.name); setContextMenu(null) }}
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
  )
}
