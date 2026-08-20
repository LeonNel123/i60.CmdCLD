import { describe, expect, it } from 'vitest'
import { detectTerminals, openExternalTerminal } from '../src/main/external-terminal'

// Opening a shell at a project folder is only useful if it survives the app and if the
// folder path never has to get through a shell parser — that is where this kind of
// feature normally breaks on paths with spaces or ampersands.
describe('detectTerminals', () => {
  const found = detectTerminals()

  it('finds at least one terminal on this machine', () => {
    expect(found.length).toBeGreaterThan(0)
  })

  it('gives every candidate an id, a name and a command', () => {
    for (const t of found) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.cmd).toBeTruthy()
      expect(Array.isArray(t.args)).toBe(true)
    }
  })

  it('uses unique ids so the menu can key on them', () => {
    expect(new Set(found.map((t) => t.id)).size).toBe(found.length)
  })

  // Anything not passing the folder as an argument gets it via cwd instead, which is
  // what keeps quoting out of the picture entirely.
  it('never embeds the folder in a command string', () => {
    for (const t of found) {
      expect(t.args.join(' ')).not.toMatch(/cd |Set-Location|\$\{/)
    }
  })
})

describe('openExternalTerminal', () => {
  it('refuses a path that does not exist', () => {
    const r = openExternalTerminal('/definitely/not/a/real/folder/xyzzy')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no longer exists/i)
  })

  it('refuses a file rather than a folder', () => {
    const r = openExternalTerminal(new URL(import.meta.url).pathname.replace(/^\//, ''))
    expect(r.ok).toBe(false)
  })
})
