import * as pty from 'node-pty'
import { WebContents } from 'electron'
import { execFileSync } from 'child_process'
import { EventEmitter } from 'events'

// Detect the best available shell for the platform
function getShell(): string {
  if (process.platform === 'darwin') {
    return process.env.SHELL || '/bin/zsh'
  }
  if (process.platform !== 'win32') {
    return process.env.SHELL || '/bin/bash'
  }
  // Windows: prefer pwsh (PowerShell 7+), fall back to Windows PowerShell 5.1
  try {
    execFileSync('pwsh', ['-Version'], { stdio: 'ignore' })
    return 'pwsh.exe'
  } catch {
    return 'powershell.exe'
  }
}

const SHELL = getShell()

export class ScrollbackBuffer {
  private chunks: string[] = []
  private totalLength = 0

  constructor(private maxSize: number) {}

  push(data: string): void {
    this.chunks.push(data)
    this.totalLength += data.length
    while (this.totalLength > this.maxSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!
      this.totalLength -= removed.length
    }
  }

  getAll(): string {
    return this.chunks.join('')
  }

  clear(): void {
    this.chunks = []
    this.totalLength = 0
  }
}

export interface TerminalMeta {
  id: string
  path: string
  name: string
  color: string
}

interface PtyEntry {
  process: pty.IPty
  webContents: WebContents
  scrollback: ScrollbackBuffer
  meta: TerminalMeta
  cols: number
  rows: number
  dataDisposable: { dispose: () => void } | null
  exitDisposable: { dispose: () => void } | null
  pendingData: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

const SCROLLBACK_SIZE = 200_000

// node-pty delivers output in many small chunks (often ~30 chars every few
// ms during heavy output). Each chunk fired an IPC send + a socket.io emit
// per connected client, which was the dominant overhead on the Tailscale
// path. Coalesce within one animation frame — imperceptible latency,
// 10-50× fewer events during floods like `npm install`.
const PTY_FLUSH_MS = 16

export class PtyManager extends EventEmitter {
  private ptys = new Map<string, PtyEntry>()

  constructor() {
    super()
  }

  create(id: string, cwd: string, webContents: WebContents, meta: TerminalMeta): void {
    const ptyProcess = pty.spawn(SHELL, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    })

    const scrollback = new ScrollbackBuffer(SCROLLBACK_SIZE)
    const entry: PtyEntry = {
      process: ptyProcess,
      webContents,
      scrollback,
      meta,
      cols: 80,
      rows: 24,
      dataDisposable: null,
      exitDisposable: null,
      pendingData: '',
      flushTimer: null,
    }

    const flush = (): void => {
      if (entry.flushTimer) {
        clearTimeout(entry.flushTimer)
        entry.flushTimer = null
      }
      if (!entry.pendingData) return
      const data = entry.pendingData
      entry.pendingData = ''
      this.emit('data', { id, data })
      try {
        if (!entry.webContents.isDestroyed()) {
          entry.webContents.send(`pty:data:${id}`, data)
        }
      } catch {}
    }

    entry.dataDisposable = ptyProcess.onData((data) => {
      scrollback.push(data)
      entry.pendingData += data
      if (!entry.flushTimer) {
        entry.flushTimer = setTimeout(flush, PTY_FLUSH_MS)
      }
    })

    entry.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      // Flush any buffered bytes before the exit notification so clients
      // see the final output before the process-gone signal.
      flush()
      this.emit('exit', { id, exitCode })
      try {
        if (!entry.webContents.isDestroyed()) {
          entry.webContents.send(`pty:exit:${id}`, exitCode)
        }
      } catch {}
      this.ptys.delete(id)
    })

    this.ptys.set(id, entry)
    this.emit('created', { id, meta })
  }

  getMeta(id: string): TerminalMeta | undefined {
    return this.ptys.get(id)?.meta
  }

  getScrollback(id: string): string {
    return this.ptys.get(id)?.scrollback.getAll() || ''
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.ptys.get(id)
    if (!entry) return
    // Skip no-op resizes so we don't spam listeners / webContents.
    if (entry.cols === cols && entry.rows === rows) return
    try {
      entry.process.resize(cols, rows)
    } catch {
      // node-pty can throw if the PTY has already exited; ignore.
      return
    }
    entry.cols = cols
    entry.rows = rows
    // Notify the desktop renderer that owns this PTY so its xterm can
    // update its cols/rows to match the new authoritative size. This keeps
    // wrapping coherent when a remote (web) client drives the resize.
    try {
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send(`pty:resize:${id}`, { cols, rows })
      }
    } catch {}
    this.emit('resize', { id, cols, rows })
  }

  getSize(id: string): { cols: number; rows: number } {
    const entry = this.ptys.get(id)
    return { cols: entry?.cols || 80, rows: entry?.rows || 24 }
  }

  kill(id: string): void {
    const entry = this.ptys.get(id)
    if (entry) {
      if (entry.flushTimer) {
        clearTimeout(entry.flushTimer)
        entry.flushTimer = null
      }
      entry.dataDisposable?.dispose()
      entry.exitDisposable?.dispose()
      entry.process.kill()
      this.ptys.delete(id)
    }
  }

  killAll(): void {
    const ids = [...this.ptys.keys()]
    for (const id of ids) {
      this.kill(id)
    }
  }

  listByWebContents(webContents: WebContents): TerminalMeta[] {
    const result: TerminalMeta[] = []
    for (const entry of this.ptys.values()) {
      if (entry.webContents === webContents) {
        result.push(entry.meta)
      }
    }
    return result
  }

  listAll(): TerminalMeta[] {
    return Array.from(this.ptys.values()).map((e) => e.meta)
  }

  has(id: string): boolean {
    return this.ptys.has(id)
  }
}
