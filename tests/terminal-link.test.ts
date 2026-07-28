import { describe, expect, it } from 'vitest'
import { findTerminalPaths, resolveTerminalPath } from '../src/shared/terminal-link'

const texts = (s: string): string[] => findTerminalPaths(s).map((m) => m.text)

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

describe('findTerminalPaths', () => {
  it('keeps the drive letter on forward-slash Windows paths', () => {
    // Regression: the drive branch was backslash-only, so "D:/Source/a.md"
    // matched from "/Source/..." via the POSIX branch and lost its "D:",
    // producing a path the main process could not read.
    expect(texts('see D:/Source/i60/docs/plan.md here'))
      .toEqual(['D:/Source/i60/docs/plan.md'])
    expect(texts('see D:\\Source\\i60\\docs\\plan.md here'))
      .toEqual(['D:\\Source\\i60\\docs\\plan.md'])
    expect(texts('d:/lower/drive.md')).toEqual(['d:/lower/drive.md'])
  })

  it('does not read an http URL scheme tail as a drive path', () => {
    expect(texts('https://example.com/path').some((t) => /^[A-Za-z]:/.test(t)))
      .toBe(false)
  })

  it('finds relative, bare and line-suffixed paths', () => {
    expect(texts('docs/planning/phase-59.md')).toEqual(['docs/planning/phase-59.md'])
    expect(texts('README.md')).toEqual(['README.md'])
    expect(texts('src/main/index.ts:1186')).toEqual(['src/main/index.ts:1186'])
    expect(texts('D:\\proj\\bar.ts:12:5')).toEqual(['D:\\proj\\bar.ts:12:5'])
  })

  it('reports indices so callers can map back to the buffer', () => {
    const found = findTerminalPaths('open docs/a.md now')
    expect(found).toEqual([{ index: 5, text: 'docs/a.md' }])
  })

  it('does not leak regex state between calls', () => {
    // A shared /g regex would carry lastIndex over and miss the second call.
    expect(texts('docs/a.md')).toEqual(['docs/a.md'])
    expect(texts('docs/a.md')).toEqual(['docs/a.md'])
  })
})
