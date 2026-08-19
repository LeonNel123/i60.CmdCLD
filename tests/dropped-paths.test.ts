import { describe, expect, it } from 'vitest'
import { extractDroppedPaths } from '../src/renderer/src/utils/dropped-paths'

// A dropped File carries no usable path of its own — Electron removed the
// non-standard File.path in v32. The real path has to come from
// webUtils.getPathForFile, handed in here as the resolver.
const fileNamed = (name: string): File => ({ name }) as File

describe('extractDroppedPaths', () => {
  it('resolves each file through the resolver', () => {
    const files = [fileNamed('a.ts'), fileNamed('b.ts')]
    const paths = extractDroppedPaths(files, (f) => `/proj/${f.name}`)
    expect(paths).toEqual(['/proj/a.ts', '/proj/b.ts'])
  })

  it('ignores the legacy File.path property', () => {
    // Regression: reading f.path yielded undefined for every drop, so the
    // handler silently forwarded nothing.
    const legacy = Object.assign(fileNamed('a.ts'), { path: '/stale/a.ts' })
    expect(extractDroppedPaths([legacy], () => '/real/a.ts')).toEqual(['/real/a.ts'])
  })

  it('drops files the resolver cannot resolve', () => {
    const files = [fileNamed('a.ts'), fileNamed('b.ts'), fileNamed('c.ts')]
    const paths = extractDroppedPaths(files, (f) => (f.name === 'b.ts' ? '' : `/proj/${f.name}`))
    expect(paths).toEqual(['/proj/a.ts', '/proj/c.ts'])
  })

  it('survives a resolver that throws for one file', () => {
    const files = [fileNamed('ok.ts'), fileNamed('bad.ts')]
    const paths = extractDroppedPaths(files, (f) => {
      if (f.name === 'bad.ts') throw new Error('not a real file')
      return `/proj/${f.name}`
    })
    expect(paths).toEqual(['/proj/ok.ts'])
  })

  it('returns an empty list for an empty drop', () => {
    expect(extractDroppedPaths([], () => '/x')).toEqual([])
  })
})
