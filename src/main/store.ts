// src/main/store.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface WindowState {
  id: string
  bounds: { width: number; height: number; x: number; y: number }
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
      writeFileSync(this.filePath, JSON.stringify(state, null, 2))
    } catch {}
  }

  getWindowBounds(windowId?: string): { width: number; height: number; x: number; y: number } {
    const win = this.state.windows.find((w) => w.id === windowId)
    return win?.bounds || { width: 1200, height: 800, x: 100, y: 100 }
  }

  saveWindowBounds(windowId: string, bounds: { width: number; height: number; x: number; y: number }): void {
    const win = this.state.windows.find((w) => w.id === windowId)
    if (win) {
      win.bounds = bounds
    } else {
      this.state.windows.push({
        id: windowId,
        bounds,
        sidebarCollapsed: true,
        viewMode: 'grid',
        folders: [],
      })
    }
    this.save(this.state)
  }
}
