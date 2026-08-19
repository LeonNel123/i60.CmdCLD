// src/main/store.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { dirname } from 'path'

export interface WindowState {
  id: string
  bounds: { width: number; height: number; x: number; y: number }
  // Whether the window was maximized. Stored alongside `bounds`, which always
  // holds the *restored* (un-maximized) size — so we can reopen maximized yet
  // still un-maximize back to the right size.
  maximized?: boolean
  sidebarCollapsed: boolean
  viewMode: 'grid' | { focused: string }
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
}

export interface MultiWindowState {
  windows: WindowState[]
}

interface LegacyState {
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
  windowBounds: { width: number; height: number; x: number; y: number }
}

const DEFAULT_STATE: MultiWindowState = { windows: [] }

export class Store {
  private state: MultiWindowState

  constructor(private filePath: string) {
    this.state = this.loadFromDisk()
  }

  private loadFromDisk(): MultiWindowState {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        if (raw.windows && Array.isArray(raw.windows)) {
          return raw as MultiWindowState
        }
        if (raw.folders && Array.isArray(raw.folders)) {
          return this.migrate(raw as LegacyState)
        }
      }
    } catch {
      // corrupted file
    }
    return { windows: [] }
  }

  private migrate(legacy: LegacyState): MultiWindowState {
    return {
      windows: [{
        id: 'migrated',
        bounds: legacy.windowBounds || { width: 1200, height: 800, x: 100, y: 100 },
        sidebarCollapsed: false,
        viewMode: 'grid',
        folders: legacy.folders || [],
      }],
    }
  }

  load(): MultiWindowState {
    return this.state
  }

  save(state: MultiWindowState): void {
    this.state = state
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      // Write-then-rename: load() silently falls back to an empty state on
      // unparseable JSON, so a half-written file would quietly lose every
      // window layout. The rename is atomic — the real file only ever holds
      // a complete write.
      const tmp = this.filePath + '.tmp'
      writeFileSync(tmp, JSON.stringify(state, null, 2))
      renameSync(tmp, this.filePath)
    } catch {}
  }

  getWindowBounds(windowId?: string): { width: number; height: number; x: number; y: number } {
    const win = this.state.windows.find((w) => w.id === windowId)
    return win?.bounds || { width: 1200, height: 800, x: 100, y: 100 }
  }

  getWindowMaximized(windowId?: string): boolean {
    const win = this.state.windows.find((w) => w.id === windowId)
    return win?.maximized ?? false
  }

  saveWindowBounds(windowId: string, bounds: { width: number; height: number; x: number; y: number }, maximized = false): void {
    const win = this.state.windows.find((w) => w.id === windowId)
    if (win) {
      win.bounds = bounds
      win.maximized = maximized
    } else {
      this.state.windows.push({
        id: windowId,
        bounds,
        maximized,
        sidebarCollapsed: true,
        viewMode: 'grid',
        folders: [],
      })
    }
    this.save(this.state)
  }
}
