import { describe, expect, it } from 'vitest'
import { resolveTerminalPath } from '../src/shared/terminal-link'

describe('resolveTerminalPath', () => {
  it('prefixes relative paths that contain separators (the docs/LPR_REPORTS.md bug)', () => {
    expect(resolveTerminalPath('docs/LPR_REPORTS.md', 'D:\\proj', 'win32'))
      .toBe('D:\\proj\\docs/LPR_REPORTS.md')
    expect(resolveTerminalPath('docs/notes.md', '/home/leon/proj', 'linux'))
      .toBe('/home/leon/proj/docs/notes.md')
  })

  it('still prefixes bare filenames (previous behavior)', () => {
    expect(resolveTerminalPath('README.md', 'D:\\proj', 'win32'))
      .toBe('D:\\proj\\README.md')
  })

  it('leaves absolute paths alone', () => {
    expect(resolveTerminalPath('D:\\proj\\docs\\a.md', 'D:\\other', 'win32'))
      .toBe('D:\\proj\\docs\\a.md')
    expect(resolveTerminalPath('D:/proj/docs/a.md', 'D:\\other', 'win32'))
      .toBe('D:/proj/docs/a.md')
    expect(resolveTerminalPath('\\\\server\\share\\a.md', 'D:\\other', 'win32'))
      .toBe('\\\\server\\share\\a.md')
    expect(resolveTerminalPath('/etc/hosts', '/home/leon', 'linux'))
      .toBe('/etc/hosts')
  })

  it('strips trailing :line and :line:col suffixes', () => {
    expect(resolveTerminalPath('docs/a.md:12', 'D:\\proj', 'win32'))
      .toBe('D:\\proj\\docs/a.md')
    expect(resolveTerminalPath('src/main.ts:12:5', '/proj', 'linux'))
      .toBe('/proj/src/main.ts')
    expect(resolveTerminalPath('D:\\proj\\a.md:7', 'D:\\proj', 'win32'))
      .toBe('D:\\proj\\a.md')
  })
})
