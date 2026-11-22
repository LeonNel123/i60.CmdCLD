import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { cleanFolderInput, folderPathPlaceholder } from '../src/shared/folder-input'
import { resolveFolderInput } from '../src/main/folder-resolve'

// The browser page has no native folder picker, so the path is typed or
// pasted. What was typed went straight into the launch flow.
describe('cleanFolderInput', () => {
  it('strips the quotes Explorer\'s "Copy as path" adds', () => {
    expect(cleanFolderInput('"D:\\2026\\foo"')).toBe('D:\\2026\\foo')
  })
  it('strips single quotes a shell adds around a dragged path', () => {
    expect(cleanFolderInput("'/Users/me/my project'")).toBe('/Users/me/my project')
  })
  it('trims whitespace inside and outside the quotes', () => {
    expect(cleanFolderInput('  " D:\\foo "  ')).toBe('D:\\foo')
  })
  it('leaves a quote that is part of the name', () => {
    expect(cleanFolderInput('/tmp/it\'s here')).toBe('/tmp/it\'s here')
    expect(cleanFolderInput('"')).toBe('"')
  })
})

describe('folderPathPlaceholder', () => {
  it('shows a path in the host\'s own style', () => {
    expect(folderPathPlaceholder('win32')).toBe('C:\\path\\to\\project')
    expect(folderPathPlaceholder('darwin')).toBe('/path/to/project')
    expect(folderPathPlaceholder('linux')).toBe('/path/to/project')
  })
})

describe('resolveFolderInput', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmdcld-folder-'))
  const sub = join(dir, 'Proj One')
  mkdirSync(sub)
  writeFileSync(join(dir, 'file.txt'), 'x')
  const ok = (raw: string) => {
    const r = resolveFolderInput(raw)
    if (!r.ok) throw new Error(r.error)
    return r.path
  }

  it('accepts an existing folder as typed', () => {
    expect(ok(sub).toLowerCase()).toBe(sub.toLowerCase())
  })

  it('accepts it quoted and with a trailing separator', () => {
    expect(ok(`"${sub}"`)).toBe(ok(sub))
    expect(ok(sub + '/')).toBe(ok(sub))
  })

  it('expands ~ to the home folder', () => {
    expect(ok('~').toLowerCase()).toBe(homedir().toLowerCase())
  })

  it('refuses a folder that does not exist, naming it', () => {
    const r = resolveFolderInput(join(dir, 'nope'))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('nope') })
  })

  it('refuses a file', () => {
    expect(resolveFolderInput(join(dir, 'file.txt')).ok).toBe(false)
  })

  // A relative path would resolve against wherever the app happened to start.
  it('refuses a relative path and an empty one', () => {
    expect(resolveFolderInput('projects/foo').ok).toBe(false)
    expect(resolveFolderInput('   ').ok).toBe(false)
    expect(resolveFolderInput('""').ok).toBe(false)
    expect(resolveFolderInput(undefined).ok).toBe(false)
  })

  // Windows opens `d:/2026/foo` and `D:\2026\Foo` as the same folder, but as
  // text they are different keys: a second recents row, and none of the
  // folder's remembered agent or args.
  it.runIf(process.platform === 'win32')('returns one spelling for every way of typing a Windows path', () => {
    const canonical = ok(sub)
    expect(ok(sub.split('\\').join('/'))).toBe(canonical)
    expect(ok(sub.toLowerCase())).toBe(canonical)
    expect(ok(sub.toUpperCase())).toBe(canonical)
    expect(canonical).toMatch(/^[A-Z]:\\/)
    expect(canonical.endsWith('Proj One')).toBe(true)
  })
})
