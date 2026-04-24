import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Store } from '../src/main/store'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(__dirname, '.tmp-store-test')
const TEST_FILE = join(TEST_DIR, 'sessions.json')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('Store multi-window', () => {
  it('loads new multi-window format', () => {
    const data = {
      windows: [{
        id: 'win-1',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
        sidebarCollapsed: false,
        viewMode: 'grid',
        folders: [{ path: 'C:\\project', color: '#f00', layout: { x: 0, y: 0, w: 12, h: 1 } }],
      }],
    }
    writeFileSync(TEST_FILE, JSON.stringify(data))
    const store = new Store(TEST_FILE)
    const state = store.load()
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0].folders[0].path).toBe('C:\\project')
  })

  it('migrates old single-window format', () => {
    const oldData = {
      folders: [
        { path: 'C:\\old-project', color: '#0f0', layout: { x: 0, y: 0, w: 12, h: 1 } },
      ],
      windowBounds: { x: 100, y: 100, width: 1000, height: 700 },
    }
    writeFileSync(TEST_FILE, JSON.stringify(oldData))
    const store = new Store(TEST_FILE)
    const state = store.load()
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0].folders[0].path).toBe('C:\\old-project')
    expect(state.windows[0].bounds.width).toBe(1000)
  })

  it('returns default state for empty/missing file', () => {
    const store = new Store(TEST_FILE)
    const state = store.load()
    expect(state.windows).toEqual([])
  })

  it('persists window bounds by stable window id', () => {
    const store = new Store(TEST_FILE)
    const bounds = { x: 42, y: 64, width: 1440, height: 900 }

    store.saveWindowBounds('primary', bounds)

    const reloaded = new Store(TEST_FILE)
    expect(reloaded.getWindowBounds('primary')).toEqual(bounds)
  })
})
