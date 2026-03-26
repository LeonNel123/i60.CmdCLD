import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface SessionState {
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
  windowBounds: { width: number; height: number; x: number; y: number }
}

const DEFAULT_STATE: SessionState = {
  folders: [],
  windowBounds: { width: 1200, height: 800, x: 100, y: 100 }
}

export class Store {
  private state: SessionState

  constructor(private filePath: string) {
    this.state = this.loadFromDisk()
  }

  private loadFromDisk(): SessionState {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'))
      }
    } catch {
      // corrupted file — return defaults
    }
    return { ...DEFAULT_STATE, folders: [], windowBounds: { ...DEFAULT_STATE.windowBounds } }
  }

  load(): SessionState {
    return this.state
  }

  save(state: SessionState): void {
    this.state = state
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(state, null, 2))
  }

  getWindowBounds(): SessionState['windowBounds'] {
    return this.state.windowBounds
  }

  saveWindowBounds(bounds: { width: number; height: number; x: number; y: number }): void {
    this.state.windowBounds = bounds
    this.save(this.state)
  }
}
