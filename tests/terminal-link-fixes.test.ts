import { describe, expect, it } from 'vitest'
import { findTerminalPaths, resolveTerminalPath } from '../src/shared/terminal-link'

// Regression coverage for the three gaps found reviewing PR #8.

describe('paths containing &', () => {
  // A directory called R&D is ordinary. & used to be outside the path character
  // classes, so such a path split into two fragments that both failed existsSync
  // and the link silently did nothing.
  it('matches a Windows path with an ampersand as one link', () => {
    const hits = findTerminalPaths('see ' + 'C:\\R&D\\notes.md' + ' now')
    expect(hits.map((h) => h.text)).toEqual(['C:\\R&D\\notes.md'])
  })

  it('matches a POSIX path with an ampersand as one link', () => {
    const hits = findTerminalPaths('at /srv/R&D/notes.md ok')
    expect(hits.map((h) => h.text)).toEqual(['/srv/R&D/notes.md'])
  })

  it('matches a relative path with an ampersand as one link', () => {
    const hits = findTerminalPaths('open docs/R&D/plan.md please')
    expect(hits.map((h) => h.text)).toEqual(['docs/R&D/plan.md'])
  })
})

describe('resolveTerminalPath normalisation', () => {
  it('collapses .. against a Windows root without eating the drive', () => {
    expect(resolveTerminalPath('..' + '/notes.md', 'C:\\proj', 'win32'))
      .toBe('C:\\notes.md')
  })

  it('never climbs past a Windows root', () => {
    expect(resolveTerminalPath('../../../../secrets.txt', 'C:\\proj', 'win32'))
      .toBe('C:\\secrets.txt')
  })

  it('collapses . and .. on POSIX', () => {
    expect(resolveTerminalPath('./a/../b/notes.md', '/home/me/proj', 'linux'))
      .toBe('/home/me/proj/b/notes.md')
  })

  // Separators survive verbatim when there is nothing to collapse: a CLI printing
  // a forward-slash relative path under a Windows folder yields a mixed result,
  // which Windows accepts. Rewriting them broke three existing tests.
  it('leaves an ordinary relative path joined, separators untouched', () => {
    expect(resolveTerminalPath('docs/NOTES.md', 'C:\\proj', 'win32'))
      .toBe('C:\\proj\\docs' + '/NOTES.md')
  })

  it('preserves a UNC prefix', () => {
    expect(resolveTerminalPath('\\\\srv\\share\\a\\..\\b.md', 'C:\\proj', 'win32'))
      .toBe('\\\\srv\\share\\b.md')
  })

  it('still strips a trailing :line:col', () => {
    expect(resolveTerminalPath('src/main.ts:12:5', 'C:\\proj', 'win32'))
      .toBe('C:\\proj\\src' + '/main.ts')
  })
})
