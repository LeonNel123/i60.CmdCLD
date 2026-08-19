import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { findProjectAnchor, getDefaultEditor } from '../src/main/editor-detect'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cmdcld-editor-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const touch = (name: string) => writeFileSync(join(dir, name), '')

describe('findProjectAnchor', () => {
  it('returns null for a folder with no solution or project files', () => {
    touch('index.ts')
    touch('package.json')
    expect(findProjectAnchor(dir)).toBeNull()
  })

  it('finds a .sln solution', () => {
    touch('MyApp.sln')
    expect(findProjectAnchor(dir)).toEqual({ path: join(dir, 'MyApp.sln'), name: 'MyApp.sln', kind: 'solution' })
  })

  it('finds a .slnx solution', () => {
    touch('MyApp.slnx')
    expect(findProjectAnchor(dir)).toEqual({ path: join(dir, 'MyApp.slnx'), name: 'MyApp.slnx', kind: 'solution' })
  })

  it('prefers a .sln over a bare project file', () => {
    touch('MyApp.sln')
    touch('MyApp.csproj')
    expect(findProjectAnchor(dir)?.name).toBe('MyApp.sln')
  })

  it('anchors on a project file when there is no solution', () => {
    touch('MyLib.csproj')
    expect(findProjectAnchor(dir)).toEqual({ path: join(dir, 'MyLib.csproj'), name: 'MyLib.csproj', kind: 'project' })
  })

  it('treats a solution as authoritative even when a package.json is present', () => {
    // A VS solution routinely contains frontend projects with their own
    // package.json — that must not divert the button to a code editor.
    touch('Solution.sln')
    touch('package.json')
    const anchor = findProjectAnchor(dir)
    expect(anchor?.kind).toBe('solution')
    expect(anchor?.name).toBe('Solution.sln')
  })

  it('does not descend into subdirectories', () => {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'Nested.sln'), '')
    expect(findProjectAnchor(dir)).toBeNull()
  })

  it('matches solution extensions case-insensitively', () => {
    touch('MyApp.SLN')
    expect(findProjectAnchor(dir)?.kind).toBe('solution')
  })
})

describe('getDefaultEditor', () => {
  it('prefers code, then cursor, then windsurf', () => {
    expect(getDefaultEditor([
      { id: 'sublime', name: 'Sublime Text', cmd: 'subl' },
      { id: 'cursor', name: 'Cursor', cmd: 'cursor' },
    ])?.id).toBe('cursor')
  })

  it('falls back to the first available editor', () => {
    expect(getDefaultEditor([{ id: 'sublime', name: 'Sublime Text', cmd: 'subl' }])?.id).toBe('sublime')
  })

  it('returns undefined for an empty list', () => {
    expect(getDefaultEditor([])).toBeUndefined()
  })
})
