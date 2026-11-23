import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { onTerminalDataReceived, removeTerminalActivity } from '../utils/terminal-activity'
import { livePtyCache } from '../utils/live-pty-cache'
import { logicalLineBounds } from '../utils/logical-line'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { formatPaths } from '../utils/format-paths'
import { isModalOpen } from '../utils/modal-state'
import { pastePolicy, inputPlatformOf, browserClipboardKey, pastedImageFile, terminalYieldsKey } from '../remote/input-policy'
import { primeNativeCopy } from '../remote/copy-text'
import { extractDroppedPaths } from '../utils/dropped-paths'
import { AGENT_CLI_LABELS, buildAgentLaunchCommand, type AgentCli } from '../../../shared/agent-cli'
import { findTerminalPaths, resolveTerminalPath, terminalLinkAction, shouldFollowLink, linkGestureHint } from '../../../shared/terminal-link'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  clampTerminalFontSize,
  pointsToPixels,
  resolveTerminalFontFamily,
} from '../../../shared/terminal-font'

// Global set of PTY IDs that have been created — prevents duplicates on remount

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
  forgetPty(id)
  window.api.killTerminal(id)
}

// This window's bookkeeping for a PTY that is already gone — closed from
// another client. Without it the cache still says "running" and a remount
// would skip straight to replaying a scrollback that no longer exists.
export function forgetPty(id: string): void {
  livePtyCache.forget(id)
  removeTerminalActivity(id)
}


interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  agentCli?: AgentCli
  claudeArgs?: string
  codexArgs?: string
  grokArgs?: string
  opencodeArgs?: string
  isPlainShell?: boolean
  elevated?: boolean
  fontFamily?: string
  fontSize?: number
  onClose: () => void
  // Window-style controls: minimize tucks the tile into the bottom taskbar;
  // maximize toggles the existing focused view.
  onMinimize?: () => void
  onToggleMaximize?: () => void
  isMaximized?: boolean
  onSpawnShell?: () => void
  onOpenMarkdown?: (filePath: string) => void
  onStartAutopilot?: () => void
  isAutopilotRunning?: boolean
  onShowAutopilotPanel?: () => void
  onNotify?: (message: string, kind?: 'info' | 'warn') => void
  // True while another device owns PTY size (a /desktop browser client is
  // connected): mirror the PTY's cols/rows, never fit-and-claim. Flipping back
  // to false refits once so this window takes the size over again.
  followPtySize?: boolean
}

export function TerminalPanel({
  id,
  folderPath,
  folderName,
  color,
  agentCli = 'claude',
  claudeArgs,
  codexArgs,
  grokArgs,
  opencodeArgs,
  isPlainShell,
  elevated,
  fontFamily,
  fontSize,
  onClose,
  onMinimize,
  onToggleMaximize,
  isMaximized,
  onSpawnShell,
  onOpenMarkdown,
  onStartAutopilot,
  isAutopilotRunning,
  onShowAutopilotPanel,
  onNotify,
  followPtySize = false,
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

  // Refit the grid to the container and push the resulting cols/rows to the
  // PTY. Both halves are mandatory: fit() only reflows *our* xterm, and the
  // PTY keeps whatever size it was last told until someone tells it otherwise.
  //
  // The ResizeObserver below used to be the only caller, which made the PTY
  // sync an accident of geometry — it fires on container-box changes, and a
  // font-size change doesn't move the container (termRef is `flex: 1`, sized
  // by the panel). So every font change left the PTY at the old cols/rows: the
  // CLI kept emitting lines for the old width, our narrower grid hard-wrapped
  // each one, and the ragged continuation lines read as inflated line spacing.
  // Restarting the app "fixed" it only because that built a correctly sized
  // PTY from scratch.
  //
  // Stable across a mount (id is the only dep), so the mount effect can hold
  // onto it without churning.
  const followPtySizeRef = useRef(followPtySize)
  followPtySizeRef.current = followPtySize
  const fitAndSyncPty = useCallback(() => {
    // Passive while the remote device owns the size: onTerminalResize keeps
    // our xterm at the PTY's dims, and fitting here would claim them back.
    if (followPtySizeRef.current) return
    const fitAddon = fitAddonRef.current
    const term = terminalRef.current
    if (!fitAddon || !term) return
    try { fitAddon.fit() } catch { return }
    const { cols, rows } = term
    // Skip the IPC round-trip if the PTY already matches (e.g. we just
    // absorbed a remote resize that set our xterm to these dims and the
    // container happened to fit the same size).
    const last = ptyDimsRef.current
    if (last && last.cols === cols && last.rows === rows) return
    window.api.resizeTerminal(id, cols, rows)
  }, [id])
  const fitAndSyncPtyRef = useRef(fitAndSyncPty)
  fitAndSyncPtyRef.current = fitAndSyncPty

  useEffect(() => {
    if (!termRef.current) return

    // Route a clicked terminal link/path: http(s) -> system browser; .md ->
    // in-app viewer; source/config files -> editor; everything else (incl.
    // file:// links) -> the OS default program (like double-clicking it).
    // For "~/…" paths. Asked once; until it answers they resolve against the
    // tile's folder, as before.
    let homeDir: string | undefined
    window.api.getHomeDir().then((h) => { homeDir = h }).catch(() => {})

    const openTarget = (raw: string, source: string): void => {
      if (/^https?:/i.test(raw)) { window.api.openExternal(raw, source); return }
      const isFileUrl = /^file:/i.test(raw)
      // Resolve relative paths (bare or with separators) against the
      // terminal's folder — main resolves against the app cwd, not ours.
      const filePart = isFileUrl
        ? raw.replace(/:\d+(:\d+)?$/, '') // strip trailing :line[:col]
        : resolveTerminalPath(raw, folderPath, window.api.platform, homeDir)
      const action = isFileUrl ? 'default-app' : terminalLinkAction(filePart)
      if (action === 'markdown' && onOpenMarkdown) {
        onOpenMarkdown(filePart)
      } else if (action === 'editor') {
        window.api.openInEditor(filePart, { projectPath: folderPath }).then((res) => {
          if (!res.ok) onNotifyRef.current?.(res.error || 'Could not open in editor', 'warn')
        }).catch(() => onNotifyRef.current?.('Could not open in editor', 'warn'))
      } else {
        // Main decides between opening and revealing (see open-target.ts) and
        // says what happened. The result used to be dropped, so a path that
        // did not exist, or resolved to the wrong place, was a dead click.
        window.api.openPath(isFileUrl ? raw : filePart).then((res) => {
          if (!res.ok) onNotifyRef.current?.(res.error || 'Could not open the file', 'warn')
          else if (res.revealed) onNotifyRef.current?.('Shown in its folder — programs are not run from a link', 'info')
        }).catch(() => onNotifyRef.current?.('Could not open the file', 'warn'))
      }
    }

    const mouseTracked = (): boolean => {
      const t = terminalRef.current
      return !!t && t.modes.mouseTrackingMode !== 'none'
    }
    // The keyboard's OS, not the host's: on the browser page a Windows host
    // asked a Mac for Ctrl+click, which macOS turns into a right-click.
    const onMac = inputPlatformOf(window) === 'darwin'

    // Which click follows a link — the rule, and why a second key is needed
    // while the agent tracks the mouse, is in shouldFollowLink.
    const isLinkActivation = (event?: MouseEvent | null): boolean =>
      shouldFollowLink({ mouseTracking: mouseTracked(), mac: onMac, event: event ?? false })

    // Hover hint. xterm underlines a link and shows a hand on plain hover, but
    // a plain click does nothing, and the gesture that works changes with the
    // agent's mouse mode — so say which one it is, where the pointer is.
    let linkHint: HTMLDivElement | null = null
    const hideLinkHint = (): void => { linkHint?.remove(); linkHint = null }
    const showLinkHint = (event: MouseEvent, isFile: boolean): void => {
      if (!linkHint) {
        linkHint = document.createElement('div')
        linkHint.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;white-space:nowrap;'
          + 'background:#252526;color:#cccccc;border:1px solid #454545;border-radius:4px;'
          + 'padding:2px 7px;font:11px/1.5 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)'
        document.body.appendChild(linkHint)
      }
      // The browser page cannot open a file on the PC it is talking to.
      linkHint.textContent = isFile && window.api.remote
        ? 'Files open from the desktop app only'
        : linkGestureHint({ mouseTracking: mouseTracked(), mac: onMac })
      const width = linkHint.offsetWidth
      linkHint.style.left = `${Math.max(4, Math.min(event.clientX + 12, window.innerWidth - width - 4))}px`
      linkHint.style.top = `${Math.min(event.clientY + 18, window.innerHeight - 28)}px`
    }

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
      // On a Mac, Option is the key that makes xterm keep a click to itself
      // while the program tracks the mouse (elsewhere it is Shift, always on).
      // Following a link in that state depends on it — see shouldFollowLink —
      // and without it a Mac has no native selection there either.
      macOptionClickForcesSelection: true,
      // Handle OSC 8 hyperlinks (ESC]8;;<uri>) that terminal programs emit.
      linkHandler: {
        activate: (event, uri) => { if (isLinkActivation(event)) openTarget(uri, 'osc8') },
        hover: (event) => showLinkHint(event, false),
        leave: hideLinkHint,
      },
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (isLinkActivation(event)) openTarget(uri, 'weblinks')
    }, {
      hover: (event) => showLinkHint(event, false),
      leave: hideLinkHint,
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
        // Bounded walk — see logicalLineBounds for the two ways the unbounded
        // version froze the renderer (a fully wrapped alt-buffer ring, and dumps).
        const bounds = logicalLineBounds(buffer, bufferLineNumber - 1, 64)
        if (!bounds) { callback(undefined); return }
        const { first: firstRow, last: lastRow } = bounds
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
              if (isLinkActivation(event)) openTarget(l.text, 'path-provider')
            },
            hover(event) { showLinkHint(event, true) },
            leave: hideLinkHint,
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
    // The launch write is deferred, so an unmount inside that window must cancel it —
    // otherwise it lands in whatever occupies the pty by the time it fires.
    let launchTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

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
      // null only reaches the browser page: the session was closed elsewhere.
      term.write(code == null
        ? '\r\n\x1b[33m[Session closed]\x1b[0m\r\n'
        : `\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`)
      livePtyCache.forget(id)
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
      if (xtermTextarea) {
        xtermTextarea.removeEventListener('paste', blockNativePaste, true)
        xtermTextarea.removeEventListener('paste', uploadImagePaste, true)
      }
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
      const paths = extractDroppedPaths(files, (f) => window.api.getPathForFile(f))
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

    // Block xterm's internal paste handler — Electron only. The browser page
    // has no OS-clipboard access for images/files, and xterm's own DOM paste
    // handler is the one path that works in an insecure (plain http) context.
    const paste = pastePolicy(Boolean(window.api.remote))
    const xtermTextarea = termRef.current!.querySelector('textarea')
    const blockNativePaste = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (xtermTextarea && paste.interceptNativePaste) {
      xtermTextarea.addEventListener('paste', blockNativePaste, true)
    }
    // Browser page: an image-only paste is uploaded (the server types the saved
    // path); anything with text falls through to xterm's own paste handler.
    function uploadImagePaste(e: ClipboardEvent): void {
      const upload = window.api.uploadPastedImage
      const image = upload && e.clipboardData ? pastedImageFile(e.clipboardData.items) : null
      if (!image) return
      e.preventDefault()
      e.stopPropagation()
      upload!(id, image).catch((err) => { console.warn('[paste] image upload failed:', err) })
    }
    if (xtermTextarea && window.api.remote) {
      xtermTextarea.addEventListener('paste', uploadImagePaste, true)
    }

    // Use Cmd on macOS, Ctrl on Windows/Linux for terminal shortcuts — the
    // keyboard's OS, which on the browser page is the client's, not the host's.
    const isMac = inputPlatformOf(window) === 'darwin'
    const modKey = (e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey

    term.attachCustomKeyEventHandler((e) => {
      // A dialog is open over the terminals: nothing typed now is for the
      // program. Declining also lets the key reach the dialog's own handler.
      if (isModalOpen()) return false
      // App shortcuts are handled on window, and xterm stops every key it
      // turns into input: decline these so they get there.
      if (terminalYieldsKey(e, isMac ? 'darwin' : 'other')) return false
      // Browser page: copy and paste shortcuts go to the browser's native
      // clipboard events — the only path that works over plain http.
      if (window.api.remote) {
        const clip = browserClipboardKey(e, isMac ? 'darwin' : 'other', term.hasSelection())
        if (clip === 'copy') primeNativeCopy(term.textarea, term.getSelection())
        if (clip) return false
      }
      if (e.type === 'keydown' && modKey(e) && e.key === 'c' && term.hasSelection()) {
        window.api.clipboardWriteText(term.getSelection())
        return false
      }
      if (e.type === 'keydown' && modKey(e) && e.key === 'v' && paste.interceptModV) {
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
      if (e.type === 'keyup' && modKey(e) && e.key === 'v' && paste.interceptModV) {
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
        fitAndSyncPtyRef.current()
        return false
      }
      if (e.type === 'keydown' && modKey(e) && e.key === '-') {
        const newSize = Math.max(term.options.fontSize! - 1, pointsToPixels(TERMINAL_FONT_SIZE_MIN))
        term.options.fontSize = newSize
        fitAndSyncPtyRef.current()
        return false
      }
      // Mod+0: reset zoom back to the configured size (converted points -> px)
      if (e.type === 'keydown' && modKey(e) && e.key === '0') {
        term.options.fontSize = pointsToPixels(fontRef.current.size)
        fitAndSyncPtyRef.current()
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
      // The frame is not cancellable from cleanup, so it can land after the terminal has
      // been disposed — fit() then reaches through a torn-down element and throws inside
      // a rAF callback, where nothing catches it.
      if (disposed) return
      fitAddon.fit()

      // `livePtyCache` is renderer-module state while PTY lifetime belongs to main, so it
      // is a cache, not the truth. Anything that creates a pty main-side (a remote
      // session, an Autopilot reviewer terminal) or resets this module leaves the two
      // disagreeing, and the disagreement used to be resolved the dangerous way: by
      // relaunching into a session that was already running. Ask main when the local
      // cache says "new".
      void (async () => {
        let alreadyRunning = livePtyCache.has(id)
        if (!alreadyRunning) {
          try {
            alreadyRunning = await window.api.terminalExists(id)
          } catch {
            // Main unreachable — fall through to the create path. That is safe only
            // because the launch write below is chained to a successful create: if the
            // pty does exist, pty:create is refused and nothing is typed into it.
          }
        }
        if (disposed) return

        if (!alreadyRunning) {
          // First mount — create PTY and launch the selected agent CLI.
          livePtyCache.add(id)
          const launchArgs = { claude: claudeArgs, codex: codexArgs, grok: grokArgs, opencode: opencodeArgs }[agentCli]
          // Spawn at the grid we just fitted. The ResizeObserver's first sync
          // races the spawn and a resize for a not-yet-existing pty is dropped,
          // which used to leave the agent launching into 80x24 inside a full
          // tile — its first repaints then smeared across the terminal.
          const size = { cols: term.cols, rows: term.rows }
          window.api.createTerminal(id, folderPath, agentCli, launchArgs, elevated, size, isPlainShell).then(() => {
            if (disposed) return
            // The tile may have moved during the spawn (grid re-layout as
            // sibling tiles arrive); the pty exists now, so this one lands.
            fitAndSyncPtyRef.current()
            if (isPlainShell) return
            // Chained to a *successful* create, never fired on a bare timer. When
            // pty:create is refused it is because the id is already in use — that is,
            // precisely when an agent is running in it — so an unconditional write typed
            // the launch command into the live session as a chat message.
            const launchCmd = buildAgentLaunchCommand(agentCli, launchArgs)
            launchTimer = setTimeout(() => {
              window.api.writeTerminal(id, launchCmd)
              claudeLaunched = true
            }, 1000)
          }).catch((err) => {
            // Surface the real reason — a bare failure banner is undebuggable.
            const raw = err instanceof Error ? err.message : String(err)
            const msg = raw.replace(/^Error invoking remote method 'pty:create': (Error: )?/, '')
            term.write(`\r\n\x1b[31m[Failed to create terminal]\x1b[0m\r\n${msg}\r\n`)
            livePtyCache.forget(id)
          })
        } else {
          // Remount — PTY exists, replay scrollback to restore terminal content. Re-seed
          // the cache so a renderer that had lost this id stops re-asking main.
          livePtyCache.add(id)
          // While another device owns PTY size this tile mirrors it, and it
          // learns the size only from pty:resize events — none arrives for a
          // size set before this mount. Ask, or the tile keeps what it just
          // fitted to itself: a session a browser created at 140 columns
          // replayed and ran wrapped at this tile's 60 until the remote
          // layout next changed. Sized before the replay so that wraps right.
          const sized = followPtySizeRef.current
            ? window.api.getTerminalSize(id).then(({ cols, rows }) => {
                if (disposed || !followPtySizeRef.current) return
                ptyDimsRef.current = { cols, rows }
                if (term.cols !== cols || term.rows !== rows) {
                  try { term.resize(cols, rows) } catch {}
                }
              }).catch(() => {})
            : Promise.resolve()
          sized.then(() => window.api.getScrollback(id)).then((data) => {
            if (!disposed && data) term.write(data)
          }).catch(() => {})
          claudeLaunched = true
        }
      })()
    })

    // Debounced resize observer — fires only when the container's actual
    // pixel dimensions change (sidebar toggle, window resize). Font changes
    // leave the container alone, so they call fitAndSyncPty directly instead.
    // We fit to our container and claim the PTY size, which broadcasts to
    // every other client. Remote-driven resizes come in via onTerminalResize
    // above and don't touch the container, so they don't retrigger this.
    let resizeTimer: ReturnType<typeof setTimeout>
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => fitAndSyncPtyRef.current(), 100)
    })
    resizeObserver.observe(termRef.current)

    return () => {
      disposed = true
      hideLinkHint()
      clearTimeout(launchTimer)
      clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      // Forget, don't trust: with no panel there is no exit listener, so the next
      // mount must ask main whether the pty still exists (see live-pty-cache).
      livePtyCache.forget(id)
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
  }, [id, folderPath, agentCli, claudeArgs, codexArgs, grokArgs, opencodeArgs, isPlainShell])

  // Live-apply font-setting changes to the existing terminal, no re-mount.
  // Skips the first run: the mount effect above already built the terminal
  // with the current font and fits it after layout (via requestAnimationFrame).
  // Fitting here before that initial layout would compute a bogus size.
  const fontApplyDoneRef = useRef(false)
  // Ownership came back to this window: fit once and claim the PTY size.
  const followApplyDoneRef = useRef(false)
  useEffect(() => {
    if (!followApplyDoneRef.current) { followApplyDoneRef.current = true; return }
    if (!followPtySize) fitAndSyncPty()
  }, [followPtySize, fitAndSyncPty])

  useEffect(() => {
    if (!fontApplyDoneRef.current) { fontApplyDoneRef.current = true; return }
    const term = terminalRef.current
    if (!term) return
    term.options.fontFamily = fontFamilyResolved
    term.options.fontSize = pointsToPixels(fontSizeResolved)
    // Same mutate-then-fit pattern the zoom shortcuts use. The PTY sync is
    // not optional here: the container doesn't move when the font does, so
    // nothing else would tell the PTY its grid just changed.
    fitAndSyncPty()
  }, [fontFamilyResolved, fontSizeResolved, fitAndSyncPty])

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

  // Minimize / maximize / close share the muted look of the old close button.
  const windowBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: '13px', padding: '0 7px',
    lineHeight: 1, height: '100%',
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
        {/* Col 1: Folder name — drag handle; double-click toggles maximize,
            mirroring OS title-bar behavior */}
        <div
          className="drag-handle"
          onDoubleClick={onToggleMaximize}
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
            {/* Every CLI is labelled, Claude included. The label used to be suppressed
                for Claude as the default — redundant when it was the only alternative to
                a plain shell. With four CLIs in the grid, an unlabelled tile is ambiguous
                rather than implied. */}
            {!isPlainShell && (
              <span style={{ color: '#888', fontSize: '10px', marginLeft: '6px', fontWeight: 400 }}>
                {AGENT_CLI_LABELS[agentCli]}
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
          {!window.api.remote && (
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
          )}
          {!window.api.remote && (
          <button onClick={() => window.api.openInExplorer(folderPath)} onMouseDown={(e) => e.stopPropagation()} title={window.api.platform === 'darwin' ? 'Open in Finder' : 'Open in Explorer'} style={actionBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5l.5.5v10l-.5.5h-13l-.5-.5v-12l.5-.5zM2 13h12V4H7.06l-1-2H2v11z"/></svg>
          </button>
          )}
        </div>

        {/* Col 3: Autopilot */}
        {!isPlainShell && onStartAutopilot && !isAutopilotRunning && !window.api.remote && (
          <button
            onClick={onStartAutopilot}
            title="Start Autopilot"
            style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: '0 6px', fontSize: 12 }}
          >
            🤖 Autopilot
          </button>
        )}
        {!isPlainShell && isAutopilotRunning && onShowAutopilotPanel && !window.api.remote && (
          <button
            onClick={onShowAutopilotPanel}
            title="Show autopilot panel"
            style={{ background: 'rgba(167,139,250,0.2)', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: '0 8px', fontSize: 11, borderRadius: 4 }}
          >
            🤖 Active
          </button>
        )}

        {/* Col 4: Window controls — minimize, maximize/restore, close */}
        {onMinimize && (
          <button
            onClick={onMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            title="Minimize to taskbar"
            style={windowBtnStyle}
          >
            &#8722;
          </button>
        )}
        {onToggleMaximize && (
          <button
            onClick={onToggleMaximize}
            onMouseDown={(e) => e.stopPropagation()}
            title={isMaximized ? 'Restore grid' : 'Maximize'}
            style={{ ...windowBtnStyle, fontSize: '11px' }}
          >
            {isMaximized ? <>&#10064;</> : <>&#9633;</>}
          </button>
        )}
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          title="Close terminal"
          style={windowBtnStyle}
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
