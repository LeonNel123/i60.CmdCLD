import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Store, SessionState } from '../src/main/store'

let tempDir: string
let store: Store

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cmdcld-test-'))
  store = new Store(join(tempDir, 'sessions.json'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Store', () => {
  it('returns default state when no file exists', () => {
    const state = store.load()
    expect(state.folders).toEqual([])
    expect(state.windowBounds).toBeDefined()
    expect(state.windowBounds.width).toBeGreaterThan(0)
  })

  it('saves and loads state', () => {
    const state: SessionState = {
      folders: [{ path: 'C:\\test', color: '#f472b6', layout: { x: 0, y: 0, w: 12, h: 1 } }],
      windowBounds: { width: 1400, height: 900, x: 50, y: 50 }
    }
    store.save(state)
    const loaded = new Store(join(tempDir, 'sessions.json')).load()
    expect(loaded).toEqual(state)
  })

  it('writes valid JSON to disk', () => {
    store.save({
      folders: [{ path: 'C:\\proj', color: '#22c55e', layout: { x: 0, y: 0, w: 6, h: 1 } }],
      windowBounds: { width: 1200, height: 800, x: 0, y: 0 }
    })
    const raw = readFileSync(join(tempDir, 'sessions.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.folders).toHaveLength(1)
  })

  it('handles corrupted file gracefully', () => {
    writeFileSync(join(tempDir, 'sessions.json'), 'NOT JSON')
    const s = new Store(join(tempDir, 'sessions.json'))
    expect(s.load().folders).toEqual([])
  })
})
