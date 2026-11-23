import { describe, expect, it } from 'vitest'
import { changedSettings } from '../src/shared/settings-diff'

// Save used to write every setting the dialog knows, taken from the copy it
// loaded when it opened. Anything changed elsewhere while the dialog was open
// (the other client, a favourite added from the sidebar) was written back to
// its old value.
describe('changedSettings', () => {
  const loaded = { claudeArgs: '--a', remotePort: 3456, askBeforeLaunch: false, favoriteFolders: ['/a', '/b'] }

  it('returns nothing when nothing was edited', () => {
    expect(changedSettings(loaded, { ...loaded, favoriteFolders: ['/a', '/b'] })).toEqual({})
  })

  it('returns only the keys that were edited', () => {
    expect(changedSettings(loaded, { ...loaded, claudeArgs: '--b', askBeforeLaunch: true }))
      .toEqual({ claudeArgs: '--b', askBeforeLaunch: true })
  })

  it('compares lists by content and order', () => {
    expect(changedSettings(loaded, { ...loaded, favoriteFolders: ['/b', '/a'] })).toEqual({ favoriteFolders: ['/b', '/a'] })
    expect(changedSettings(loaded, { ...loaded, favoriteFolders: ['/a'] })).toEqual({ favoriteFolders: ['/a'] })
  })

  it('writes a key the loaded copy did not have', () => {
    expect(changedSettings(loaded, { ...loaded, disableShortcuts: true })).toEqual({ disableShortcuts: true })
  })

  it('writes everything when nothing was loaded', () => {
    expect(changedSettings(null, { claudeArgs: '--a' })).toEqual({ claudeArgs: '--a' })
  })
})
