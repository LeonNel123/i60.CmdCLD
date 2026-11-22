import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { Settings } from '../src/main/settings'
import { createSettingsBroadcast } from '../src/main/settings-broadcast'

// Settings live in main, but each client (the desktop window, a /desktop
// browser tab) keeps its own copy and nothing told the other when one of them
// wrote. A tab left open kept launching with flags removed on the PC, and
// either side could overwrite the other's favourites from a stale list.

const TMP = join(__dirname, '.tmp-settings-broadcast-test')

describe('Settings.onChange', () => {
  beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

  it('reports the key of every write', () => {
    const settings = new Settings(join(TMP, 'settings.json'))
    const keys: string[] = []
    settings.onChange((key) => keys.push(key))
    settings.set('claudeArgs', '--model opus')
    settings.set('favoriteFolders', ['D:/a'])
    expect(keys).toEqual(['claudeArgs', 'favoriteFolders'])
  })

  it('reports after the value is readable', () => {
    const settings = new Settings(join(TMP, 'settings.json'))
    let seen = ''
    settings.onChange(() => { seen = settings.get('claudeArgs') })
    settings.set('claudeArgs', '--x')
    expect(seen).toBe('--x')
  })

  it('stops reporting after unsubscribe', () => {
    const settings = new Settings(join(TMP, 'settings.json'))
    const keys: string[] = []
    const off = settings.onChange((key) => keys.push(key))
    off()
    settings.set('claudeArgs', '--x')
    expect(keys).toEqual([])
  })

  it('survives a listener that throws', () => {
    const settings = new Settings(join(TMP, 'settings.json'))
    const keys: string[] = []
    settings.onChange(() => { throw new Error('boom') })
    settings.onChange((key) => keys.push(key))
    expect(() => settings.set('claudeArgs', '--x')).not.toThrow()
    expect(keys).toEqual(['claudeArgs'])
  })
})

// Saving the settings dialog writes about thirty keys one after another; each
// client reloads everything on a notice, so they get one notice, not thirty.
describe('createSettingsBroadcast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('sends one notice for a burst of writes, naming each key once', () => {
    const notices: string[][] = []
    const b = createSettingsBroadcast({ notify: (keys) => notices.push(keys), delayMs: 50 })
    b.changed('claudeArgs')
    b.changed('codexArgs')
    b.changed('claudeArgs')
    expect(notices).toEqual([])
    vi.advanceTimersByTime(50)
    expect(notices).toEqual([['claudeArgs', 'codexArgs']])
  })

  it('sends a second notice for a later write', () => {
    const notices: string[][] = []
    const b = createSettingsBroadcast({ notify: (keys) => notices.push(keys), delayMs: 50 })
    b.changed('claudeArgs')
    vi.advanceTimersByTime(50)
    b.changed('favoriteFolders')
    vi.advanceTimersByTime(50)
    expect(notices).toEqual([['claudeArgs'], ['favoriteFolders']])
  })

  it('sends nothing after dispose', () => {
    const notices: string[][] = []
    const b = createSettingsBroadcast({ notify: (keys) => notices.push(keys), delayMs: 50 })
    b.changed('claudeArgs')
    b.dispose()
    vi.advanceTimersByTime(500)
    expect(notices).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
