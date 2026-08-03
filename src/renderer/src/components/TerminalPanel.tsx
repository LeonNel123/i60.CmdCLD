import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { onTerminalDataReceived, removeTerminalActivity } from '../utils/terminal-activity'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { formatPaths } from '../utils/format-paths'
import { AGENT_CLI_LABELS, buildAgentLaunchCommand, type AgentCli } from '../../../shared/agent-cli'
import { findTerminalPaths, resolveTerminalPath } from '../../../shared/terminal-link'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  clampTerminalFontSize,
  pointsToPixels,
  resolveTerminalFontFamily,
} from '../../../shared/terminal-font'

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

// Source/config extensions that open in the code editor when a terminal link
// is clicked. `.md` opens in the in-app markdown viewer; everything else —
// data/query/markup files (sql, xml, csv, …), pdf, images, archives, html, and
// any file:// link — opens with the OS default program.
const EDITOR_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'yaml', 'yml', 'toml',
  'css', 'scss', 'less', 'py', 'rs', 'go', 'java', 'kt', 'kts', 'c', 'cc', 'cpp',
  'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1',
  'env', 'cfg', 'ini', 'conf', 'gradle', 'vue', 'svelte',
])

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  agentCli?: AgentCli
  claudeArgs?: string
  codexArgs?: string
  isPlainShell?: boolean
  elevated?: boolean
  fontFamily?: string
  fontSize?: number
  onClose: () => void
  onSpawnShell?: () => void
  onOpenMarkdown?: (filePath: string) => void
  onStartAutopilot?: () => void
  onOpenRelay?: () => void
  isAutopilotRunning?: boolean
  onShowAutopilotPanel?: () => void
  onNotify?: (message: string, kind?: 'info' | 'warn') => void
}

export function TerminalPanel({
  id,
  folderPath,
  folderName,
  color,
  agentCli = 'claude',
  claudeArgs,
  codexArgs,
  isPlainShell,
  elevated,
  fontFamily,
  fontSize,
  onClose,
  onSpawnShell,
  onOpenMarkdown,
  onStartAutopilot,
  onOpenRelay,
  isAutopilotRunning,
  onShowAutopilotPanel,
  onNotify,
}: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  // Resolve the global terminal-font setting (with defaults) and keep it in a
  // ref so the mount effect can construct the xterm with the current font
  // WITHOUT adding font to its deps — that would tear down and recreate the
  // whole terminal on every font change. Live font changes are applied to the
  // existing instance by the effect below instead.
  const fontFamilyResolved = resolveTerminalFontFamily(fontFamily)
  const fontSizeResolved = clampTerminalFontSize(fontSize ?? DEFAULT_TERMINAL_FONT_SIZE)
  const fontRef = useRef({ family: fontFamilyResolved, size: fontSizeResolved })
  fontRef.current = { family: fontFamilyResolved, size: fontSizeResolved }
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
  // Carry-over of the last few bytes of the previous PTY chunk, used when
  // sniffing bracketed-paste-mode toggles. Without this, a split escape
  // sequence (e.g. chunk ends "\x1b[?20" and the next starts "04h") is
  // missed and bracketedPasteRef gets stuck stale for the rest of the
  // session, breaking pasted multi-line content.
  const sniffTailRef = useRef('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [availableEditors, setAvailableEditors] = useState<Array<{ id: string; name: string; cmd: string }>>([])
  // A Visual Studio solution/project at the folder root, if any — the button
  // opens it (via the OS association) instead of the folder-in-editor default.
  const [projectAnchor, setProjectAnchor] = useState<{ path: string; name: string; kind: 'solution' | 'project' } | null>(null)
  // The chosen default editor for this folder: per-project override, else global.
  // resolvedId is null until the user picks one — then the button opens it
  // directly instead of showing the picker.
  const [editorDefaults, setEditorDefaults] = useState<{ global: string; project: string; resolvedId: string | null }>({ global: '', project: '', resolvedId: null })
  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    if (!termRef.current) return

    // Route a clicked terminal link/path: http(s) -> system browser; .md ->
    // in-app viewer; source/config files -> editor; everything else (incl.
    // file:// links) -> the OS default program (like double-clicking it).
    const openTarget = (raw: string): void => {
      if (/^https?:/i.test(raw)) { window.api.openExternal(raw); return }
      const isFileUrl = /^file:/i.test(raw)
      // Resolve relative paths (bare or with separators) against the
      // terminal's folder — main resolves against the app cwd, not ours.
      const filePart = isFileUrl
        ? raw.replace(/:\d+(:\d+)?$/, '') // strip trailing :line[:col]
        : resolveTerminalPath(raw, folderPath, window.api.platform)
      const base = filePart.split(/[\\/]/).pop() || ''
      const dotIdx = base.lastIndexOf('.')
      const ext = dotIdx > 0 ? base.slice(dotIdx + 1).toLowerCase() : ''
      if (!isFileUrl && ext === 'md' && onOpenMarkdown) {
        onOpenMarkdown(filePart)
      } else if (!isFileUrl && EDITOR_EXTS.has(ext)) {
        window.api.openInEditor(filePart, { projectPath: folderPath }).then((res) => {
          if (!res.ok) onNotifyRef.current?.(res.error || 'Could not open in editor', 'warn')
        }).catch(() => onNotifyRef.current?.('Could not open in editor', 'warn'))
      } else {
        window.api.openPath(isFileUrl ? raw : filePart)
      }
    }

    // Require Ctrl+click (Cmd+click on macOS) to follow a terminal link, so a
    // stray plain click never launches a file, app, or browser — same gesture
    // as VS Code's integrated terminal. (On macOS, Ctrl+click is a right-click,
    // so we require Cmd there instead.)
    const isLinkActivation = (event?: MouseEvent | null): boolean =>
      !event || (window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey)

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
      fontFamily: fontRef.current.family,
      // fontRef.current.size is in points (matches Windows Terminal); xterm's
      // fontSize is CSS px, so convert at this boundary.
      fontSize: pointsToPixels(fontRef.current.size),
      // Handle OSC 8 hyperlinks (ESC]8;;<uri>) that terminal programs emit.
      linkHandler: { activate: (event, uri) => { if (isLinkActivation(event)) openTarget(uri) } },
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (isLinkActivation(event)) openTarget(uri)
    })
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(searchAddon)
    term.open(termRef.current)
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        try { webglAddon?.dispose() } catch {}
        webglAddon = null
      })
      term.loadAddon(webglAddon)
    } catch {
      webglAddon = null
      // WebGL unavailable (very old GPU or virtualized env) — fall back to default canvas renderer silently
    }

    // Make file paths clickable — opens in configured editor
    term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        // Long paths wrap across rows in a narrow grid panel, and a per-row
        // scan would only see (and open) the fragment on the clicked row. So
        // reassemble the full logical line — walk back to the first
        // non-wrapped row, forward across continuation rows — match on that,
        // and map string indices back to buffer coordinates.
        const buffer = term.buffer.active
        const cols = term.cols
        let firstRow = bufferLineNumber - 1
        while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) firstRow--
        let lastRow = bufferLineNumber - 1
        while (buffer.getLine(lastRow + 1)?.isWrapped) lastRow++
        // A logical line spanning this many rows is a dump (minified JSON, a
        // token blob), not something with a clickable path a human wants —
        // and reassembling + regex-scanning it on every hover is what froze
        // the renderer. Bail before building the string.
        if (lastRow - firstRow + 1 > 64) { callback(undefined); return }
        let text = ''
        for (let i = firstRow; i <= lastRow; i++) {
          const line = buffer.getLine(i)
          if (!line) { callback(undefined); return }
          // trimRight=false keeps each row exactly `cols` chars so
          // index -> row/col math stays aligned (paths are single-width ASCII;
          // wide chars would drift, but they can't appear in a path match)
          text += line.translateToString(false, 0, cols)
        }
        callback(findTerminalPaths(text).map((l) => {
          const endIdx = l.index + l.text.length - 1 // index of last char
          return {
            range: {
              start: { x: (l.index % cols) + 1, y: firstRow + Math.floor(l.index / cols) + 1 },
              end: { x: (endIdx % cols) + 2, y: firstRow + Math.floor(endIdx / cols) + 1 },
            },
            text: l.text,
            activate(event) {
              if (isLinkActivation(event)) openTarget(l.text)
            },
          }
        }))
      },
    })

    // OSC 52 clipboard: terminal programs (Claude Code, tmux, vim, …) copy to
    // the host clipboard by emitting ESC]52;c;<base64>BEL. xterm ignores this by
    // default, so decode it and write to the OS clipboard via the main process
    // (reliable, unlike navigator.clipboard). Payload is "<Pc>;<Pd>"; Pd is
    // base64, or "?" for a read request (which we ignore).
    term.parser.registerOscHandler(52, (data) => {
      const sep = data.indexOf(';')
      if (sep === -1) return true
      const payload = data.slice(sep + 1)
      if (payload === '' || payload === '?') return true
      try {
        const binary = atob(payload)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        window.api.clipboardWriteText(new TextDecoder().decode(bytes))
      } catch {
        // malformed base64 — ignore
      }
      return true
    })

    terminalRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    let claudeLaunched = false

    const removeData = window.api.onTerminalData(id, (data) => {
      // Sniff bracketed-paste mode toggles. The escape sequences are 7 bytes
      // each (`\x1b[?2004h` / `\x1b[?2004l`); they can land split across two
      // PTY chunks, so we prepend the tail of the previous chunk before
      // searching, then save a fresh tail. A single chunk can also contain
      // both toggles — the later one wins.
      const probe = sniffTailRef.current + data
      const enableIdx = probe.lastIndexOf('\x1b[?2004h')
      const disableIdx = probe.lastIndexOf('\x1b[?2004l')
      if (enableIdx >= 0 || disableIdx >= 0) {
        bracketedPasteRef.current = enableIdx > disableIdx
      }
      // Keep the last 7 bytes (length of either toggle sequence) so a
      // toggle straddling the next chunk boundary still gets caught.
      sniffTailRef.current = probe.length > 7 ? probe.slice(-7) : probe
      // Pin viewport to the bottom only when the user was already there.
      // Defends against rare WebGL-renderer cases where rapid output bursts
      // leave the viewport one row above the cursor — the symptom users
      // resolve by pressing Enter, which we don't want them to have to do.
      const buf = term.buffer.active
      const wasAtBottom = buf.viewportY >= buf.baseY
      term.write(data, () => {
        if (wasAtBottom && terminalRef.current) terminalRef.current.scrollToBottom()
      })
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
        window.api.clipboardWriteText(term.getSelection())
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
      // Mod+= / Mod+-: font zoom (ephemeral, per-terminal). term.options.fontSize
      // is in CSS px; the shared bounds are in points, so convert them so zoom
      // and the settings picker agree on the limits.
      if (e.type === 'keydown' && modKey(e) && (e.key === '=' || e.key === '+')) {
        const newSize = Math.min(term.options.fontSize! + 1, pointsToPixels(TERMINAL_FONT_SIZE_MAX))
        term.options.fontSize = newSize
        fitAddon.fit()
        return false
      }
      if (e.type === 'keydown' && modKey(e) && e.key === '-') {
        const newSize = Math.max(term.options.fontSize! - 1, pointsToPixels(TERMINAL_FONT_SIZE_MIN))
        term.options.fontSize = newSize
        fitAddon.fit()
        return false
      }
      // Mod+0: reset zoom back to the configured size (converted points -> px)
      if (e.type === 'keydown' && modKey(e) && e.key === '0') {
        term.options.fontSize = pointsToPixels(fontRef.current.size)
        fitAddon.fit()
        return false
      }
      // Mod+End: scroll to bottom without sending input. Escape hatch when
      // a long output burst leaves the last line visually below the
      // viewport and pressing Enter would otherwise send a stray \r.
      if (e.type === 'keydown' && modKey(e) && e.key === 'End') {
        term.scrollToBottom()
        return false
      }
      return true
    })

    // Fit and create PTY after layout is ready
    requestAnimationFrame(() => {
      fitAddon.fit()

      if (!activePtys.has(id)) {
        // First mount — create PTY and launch the selected agent CLI.
        activePtys.add(id)
        const launchArgs = agentCli === 'codex' ? codexArgs : claudeArgs
        window.api.createTerminal(id, folderPath, agentCli, launchArgs, elevated).catch((err) => {
          // Surface the real reason — a bare failure banner is undebuggable.
          const raw = err instanceof Error ? err.message : String(err)
          const msg = raw.replace(/^Error invoking remote method 'pty:create': (Error: )?/, '')
          term.write(`\r\n\x1b[31m[Failed to create terminal]\x1b[0m\r\n${msg}\r\n`)
          activePtys.delete(id)
        })

        if (!isPlainShell) {
          const launchCmd = buildAgentLaunchCommand(agentCli, launchArgs)
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
      // Dispose WebGL addon BEFORE the terminal — addon internals reference
      // the terminal's renderer; if the terminal disposes first the addon's
      // own dispose throws "Cannot read _isDisposed of undefined".
      try { webglAddon?.dispose() } catch {}
      webglAddon = null
      try { term.dispose() } catch {}
    }
  }, [id, folderPath, agentCli, claudeArgs, codexArgs, isPlainShell])

  // Live-apply font-setting changes to the existing terminal, no re-mount.
  // Skips the first run: the mount effect above already built the terminal
  // with the current font and fits it after layout (via requestAnimationFrame).
  // Fitting here before that initial layout would compute a bogus size.
  const fontApplyDoneRef = useRef(false)
  useEffect(() => {
    if (!fontApplyDoneRef.current) { fontApplyDoneRef.current = true; return }
    const term = terminalRef.current
    if (!term) return
    term.options.fontFamily = fontFamilyResolved
    term.options.fontSize = pointsToPixels(fontSizeResolved)
    // Same mutate-then-fit pattern the zoom shortcuts use; fit() reflows
    // cols/rows for the new cell size and (per the ResizeObserver above) syncs
    // the PTY.
    try { fitAddonRef.current?.fit() } catch {}
  }, [fontFamilyResolved, fontSizeResolved])

  // Load editors + the chosen default for this folder, and probe for a solution.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.editorGetAvailable(),
      window.api.editorGetDefaults(folderPath),
    ]).then(([editors, defs]) => {
      if (cancelled) return
      setAvailableEditors(editors)
      setEditorDefaults(defs)
    }).catch(() => {})
    window.api.editorProbeProject(folderPath)
      .then((a) => { if (!cancelled) setProjectAnchor(a) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [folderPath])

  // Open a file/folder in an editor and surface any failure as a toast. For a
  // folder the main process applies the solution-aware default unless forceFolder.
  const openInEditor = (target: string, opts?: { forceFolder?: boolean; editorId?: string }) => {
    window.api.openInEditor(target, { ...opts, projectPath: folderPath }).then((res) => {
      if (!res.ok) onNotifyRef.current?.(res.error || 'Could not open in editor', 'warn')
    }).catch(() => onNotifyRef.current?.('Could not open in editor', 'warn'))
  }

  // Left-click when a default is set: open it. VS (devenv) stays solution-aware
  // (opens the .sln if present); any other editor opens the folder itself.
  const openResolvedEditor = () => {
    const id = editorDefaults.resolvedId
    if (!id) return
    if (id === 'devenv') openInEditor(folderPath, { editorId: 'devenv' })
    else openInEditor(folderPath, { editorId: id, forceFolder: true })
  }

  const applyDefault = (scope: 'global' | 'project', editorId: string | null) => {
    window.api.editorSetDefault({ scope, editorId, projectPath: folderPath })
      .then(() => window.api.editorGetDefaults(folderPath).then(setEditorDefaults))
      .catch(() => {})
  }

  const editorMenuItems = (): ContextMenuItem[] => {
    const editorRows = availableEditors.map((e) => ({
      label: `Open folder in ${e.name}`,
      checked: editorDefaults.resolvedId === e.id,
      onClick: () => openInEditor(folderPath, { editorId: e.id, forceFolder: true }),
    }))
    const scopeSub = (scope: 'global' | 'project', current: string): ContextMenuItem[] => [
      ...availableEditors.map((e) => ({
        label: e.name,
        checked: current === e.id,
        onClick: () => applyDefault(scope, e.id),
      })),
      ...(current ? [
        { label: '', divider: true, onClick: () => {} },
        { label: 'Clear', onClick: () => applyDefault(scope, null) },
      ] : []),
    ]
    return [
      ...(projectAnchor ? [
        { label: `Open ${projectAnchor.name}`, onClick: () => openInEditor(folderPath) },
        { label: '', divider: true, onClick: () => {} },
      ] : []),
      ...editorRows,
      ...(availableEditors.length ? [{ label: '', divider: true, onClick: () => {} }] : []),
      { label: 'Default for this project', onClick: () => {}, submenu: scopeSub('project', editorDefaults.project) },
      { label: 'Default for all projects', onClick: () => {}, submenu: scopeSub('global', editorDefaults.global) },
    ]
  }

  const resolvedEditorName = availableEditors.find((e) => e.id === editorDefaults.resolvedId)?.name

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
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
            {!isPlainShell && agentCli === 'codex' && (
              <span style={{ color: '#888', fontSize: '10px', marginLeft: '6px', fontWeight: 400 }}>
                {AGENT_CLI_LABELS.codex}
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
          <button
            onClick={(e) => {
              if (editorDefaults.resolvedId) { openResolvedEditor(); return }
              if (projectAnchor || availableEditors.length > 0) {
                // No default yet — show the picker anchored under the button.
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setContextMenu({ x: r.left, y: r.bottom + 2 })
              } else {
                openInEditor(folderPath) // nothing installed → surfaces a toast
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={
              projectAnchor ? `Open ${projectAnchor.name}`
                : resolvedEditorName ? `Open folder in ${resolvedEditorName}`
                : 'Open in editor…'
            }
            style={actionBtnStyle}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>
            </button>
          <button onClick={() => window.api.openInExplorer(folderPath)} onMouseDown={(e) => e.stopPropagation()} title={window.api.platform === 'darwin' ? 'Open in Finder' : 'Open in Explorer'} style={actionBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5l.5.5v10l-.5.5h-13l-.5-.5v-12l.5-.5zM2 13h12V4H7.06l-1-2H2v11z"/></svg>
          </button>
          {onOpenRelay && (
            <button onClick={onOpenRelay} onMouseDown={(e) => e.stopPropagation()} title="Relay to another session" style={actionBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5l.5-.5h13l.5.5v9l-.5.5h-13l-.5-.5v-9zM2 5.07V12h12V5.07L8.31 9.5h-.62L2 5.07zM13.03 4H2.97L8 8.36 13.03 4z"/></svg>
            </button>
          )}
        </div>

        {/* Col 3: Autopilot */}
        {!isPlainShell && onStartAutopilot && !isAutopilotRunning && (
          <button
            onClick={onStartAutopilot}
            title="Start Autopilot"
            style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: '0 6px', fontSize: 12 }}
          >
            🤖 Autopilot
          </button>
        )}
        {!isPlainShell && isAutopilotRunning && onShowAutopilotPanel && (
          <button
            onClick={onShowAutopilotPanel}
            title="Show autopilot panel"
            style={{ background: 'rgba(167,139,250,0.2)', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: '0 8px', fontSize: 11, borderRadius: 4 }}
          >
            🤖 Active
          </button>
        )}

        {/* Col 4: Close */}
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

      {contextMenu && (projectAnchor || availableEditors.length > 0) && (
        <div onMouseDown={(e) => e.stopPropagation()}>
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={editorMenuItems()}
          onClose={() => setContextMenu(null)}
        />
        </div>
      )}
    </div>
  )
}
