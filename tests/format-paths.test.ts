import { describe, it, expect } from 'vitest'
import { formatPaths } from '../src/renderer/src/utils/format-paths'

describe('formatPaths', () => {
  it('returns unquoted path when no special characters', () => {
    expect(formatPaths(['/home/user/project/file.ts'])).toBe('/home/user/project/file.ts')
  })

  it('quotes a path that contains spaces', () => {
    expect(formatPaths(['/home/user/my project/file.ts'])).toBe('"/home/user/my project/file.ts"')
  })

  it('quotes a Windows path with spaces', () => {
    expect(formatPaths(['C:\\My Documents\\report.pdf'])).toBe('"C:\\My Documents\\report.pdf"')
  })

  it('returns multiple paths space-separated, each quoted as needed', () => {
    const result = formatPaths(['/simple/path.ts', '/path with spaces/file.ts'])
    expect(result).toBe('/simple/path.ts "/path with spaces/file.ts"')
  })

  it('escapes embedded double-quotes in path', () => {
    expect(formatPaths(['/weird/"quoted"/file.ts'])).toBe('"/weird/\\"quoted\\"/file.ts"')
  })

  it('quotes a path containing the & shell metacharacter', () => {
    expect(formatPaths(['/projects/foo&bar/file.ts'])).toBe('"/projects/foo&bar/file.ts"')
  })

  it('quotes a path containing the | shell metacharacter', () => {
    expect(formatPaths(['/projects/foo|bar/file.ts'])).toBe('"/projects/foo|bar/file.ts"')
  })

  it('quotes a path containing < or >', () => {
    expect(formatPaths(['/path/<output>/file.ts'])).toBe('"/path/<output>/file.ts"')
  })

  it('returns empty string for an empty array', () => {
    expect(formatPaths([])).toBe('')
  })

  it('handles multiple plain paths joined with a space', () => {
    expect(formatPaths(['/a/b.ts', '/c/d.ts'])).toBe('/a/b.ts /c/d.ts')
  })
})
