import { BrowserWindow } from 'electron'

export interface WindowInfo {
  id: string
  label: string
}

interface RegistryEntry {
  window: BrowserWindow
  label: string
}

export class WindowRegistry {
  private windows = new Map<string, RegistryEntry>()

  register(id: string, window: BrowserWindow): string {
    const label = this.nextLabel()
    this.windows.set(id, { window, label })
    return label
  }

  unregister(id: string): void {
    this.windows.delete(id)
  }

  get(id: string): BrowserWindow | undefined {
    return this.windows.get(id)?.window
  }

  getWebContents(id: string): Electron.WebContents | undefined {
    const entry = this.windows.get(id)
    return entry?.window.isDestroyed() ? undefined : entry?.window.webContents
  }

  list(): WindowInfo[] {
    return Array.from(this.windows.entries()).map(([id, e]) => ({
      id,
      label: e.label,
    }))
  }

  listExcluding(excludeId: string): WindowInfo[] {
    return this.list().filter((w) => w.id !== excludeId)
  }

  broadcastExcept(excludeId: string, channel: string, ...args: unknown[]): void {
    for (const [id, entry] of this.windows) {
      if (id !== excludeId && !entry.window.isDestroyed()) {
        entry.window.webContents.send(channel, ...args)
      }
    }
  }

  broadcastAll(channel: string, ...args: unknown[]): void {
    for (const [, entry] of this.windows) {
      if (!entry.window.isDestroyed()) {
        entry.window.webContents.send(channel, ...args)
      }
    }
  }

  size(): number {
    return this.windows.size
  }

  private nextLabel(): string {
    const usedNumbers = new Set(
      Array.from(this.windows.values()).map((e) => {
        const match = e.label.match(/Window (\d+)/)
        return match ? parseInt(match[1], 10) : 0
      })
    )
    let n = 1
    while (usedNumbers.has(n)) n++
    return `Window ${n}`
  }
}
