import * as pty from 'node-pty'
import { WebContents } from 'electron'

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
  dataDisposable: { dispose: () => void } | null
  exitDisposable: { dispose: () => void } | null
}

const SCROLLBACK_SIZE = 200_000

export class PtyManager {
  private ptys = new Map<string, PtyEntry>()

  create(id: string, cwd: string, webContents: WebContents, meta: TerminalMeta): void {
    const ptyProcess = pty.spawn('powershell.exe', [], {
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
      dataDisposable: null,
      exitDisposable: null,
    }

    entry.dataDisposable = ptyProcess.onData((data) => {
      scrollback.push(data)
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send(`pty:data:${id}`, data)
      }
    })

    entry.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send(`pty:exit:${id}`, exitCode)
      }
      this.ptys.delete(id)
    })

    this.ptys.set(id, entry)
  }

  move(id: string, newWebContents: WebContents): string | null {
    const entry = this.ptys.get(id)
    if (!entry) return null

    const scrollbackData = entry.scrollback.getAll()
    entry.webContents = newWebContents

    return scrollbackData
  }

  getMeta(id: string): TerminalMeta | undefined {
    return this.ptys.get(id)?.meta
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.ptys.get(id)?.process.resize(cols, rows)
  }

  kill(id: string): void {
    const entry = this.ptys.get(id)
    if (entry) {
      entry.process.kill()
      this.ptys.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.ptys) {
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
}
