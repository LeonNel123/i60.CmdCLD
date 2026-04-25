import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { LastSessionStore } from '../src/main/last-session-store'

const TMP = join(__dirname, '.tmp-last-session-test')
const FILE = join(TMP, 'last-session.json')

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('LastSessionStore', () => {
  it('returns null when the file does not exist', () => {
    const store = new LastSessionStore(FILE)
    expect(store.read()).toBe(null)
  })

  it('returns null when the file is corrupt JSON', () => {
    writeFileSync(FILE, 'not json')
    const store = new LastSessionStore(FILE)
    expect(store.read()).toBe(null)
  })

  it('returns null when the JSON has the wrong shape', () => {
    writeFileSync(FILE, JSON.stringify({ savedAt: 0, projects: 'nope' }))
    const store = new LastSessionStore(FILE)
    expect(store.read()).toBe(null)
  })

  it('writes and reads back a session', () => {
    const store = new LastSessionStore(FILE)
    const session = {
      savedAt: 1000,
      projects: [
        { path: '/x', claudeArgs: '--continue', isPlainShell: false },
        { path: '/y', claudeArgs: '', isPlainShell: true },
      ],
    }
    store.write(session)
    expect(store.read()).toEqual(session)
  })

  it('overwrites previous content on repeated writes', () => {
    const store = new LastSessionStore(FILE)
    store.write({ savedAt: 1, projects: [] })
    store.write({
      savedAt: 2,
      projects: [{ path: '/z', claudeArgs: '', isPlainShell: false }],
    })
    const read = store.read()
    expect(read?.savedAt).toBe(2)
    expect(read?.projects).toHaveLength(1)
  })

  it('clear() removes the file', () => {
    const store = new LastSessionStore(FILE)
    store.write({ savedAt: 0, projects: [] })
    expect(existsSync(FILE)).toBe(true)
    store.clear()
    expect(existsSync(FILE)).toBe(false)
  })

  it('clear() is a no-op when the file does not exist', () => {
    const store = new LastSessionStore(FILE)
    expect(() => store.clear()).not.toThrow()
  })

  it('write creates the parent directory if missing', () => {
    const nested = join(TMP, 'nested', 'subdir', 'last-session.json')
    const store = new LastSessionStore(nested)
    store.write({ savedAt: 1, projects: [] })
    expect(existsSync(nested)).toBe(true)
  })
})
