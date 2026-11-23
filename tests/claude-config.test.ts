import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'

const TMP = join(__dirname, '.tmp-claude-config-test')

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => TMP }
})

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('claude-config', () => {
  it('hardenGlobalSettings is a no-op (does not modify settings)', async () => {
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    writeFileSync(join(TMP, '.claude', 'settings.json'), JSON.stringify({
      effortLevel: 'high',
      permissions: { allow: ['Bash(ls)'] },
    }))
    const before = readFileSync(join(TMP, '.claude', 'settings.json'), 'utf-8')
    const { hardenGlobalSettings } = await import('../src/main/claude-config')
    hardenGlobalSettings()
    const after = readFileSync(join(TMP, '.claude', 'settings.json'), 'utf-8')
    expect(after).toBe(before)
  })

  it('trustFolder sets hasTrustDialogAccepted without clobbering other projects', async () => {
    writeFileSync(join(TMP, '.claude.json'), JSON.stringify({
      projects: {
        '/other/project': { hasTrustDialogAccepted: true, somethingElse: 42 },
      },
      unrelatedRoot: 'keep-me',
    }))
    const { trustFolder } = await import('../src/main/claude-config')
    trustFolder('/new/project')
    const written = JSON.parse(readFileSync(join(TMP, '.claude.json'), 'utf-8'))
    expect(written.unrelatedRoot).toBe('keep-me')
    expect(written.projects['/other/project']).toEqual({ hasTrustDialogAccepted: true, somethingElse: 42 })
    expect(written.projects['/new/project'].hasTrustDialogAccepted).toBe(true)
  })

  it('trustFolder is a no-op when already accepted', async () => {
    writeFileSync(join(TMP, '.claude.json'), JSON.stringify({
      projects: { '/p': { hasTrustDialogAccepted: true } },
    }))
    const before = readFileSync(join(TMP, '.claude.json'), 'utf-8')
    const { trustFolder } = await import('../src/main/claude-config')
    trustFolder('/p')
    const after = readFileSync(join(TMP, '.claude.json'), 'utf-8')
    expect(after).toBe(before)
  })

  it('trustFolder creates file if missing', async () => {
    expect(existsSync(join(TMP, '.claude.json'))).toBe(false)
    const { trustFolder } = await import('../src/main/claude-config')
    trustFolder('/p')
    const written = JSON.parse(readFileSync(join(TMP, '.claude.json'), 'utf-8'))
    expect(written.projects['/p'].hasTrustDialogAccepted).toBe(true)
  })

  // Claude Code rewrites ~/.claude.json constantly. Reading it mid-write, or
  // after anything else damaged it, used to count as "no file": the next line
  // wrote a fresh one holding a single project, and every other project's
  // history, MCP servers and the login state went with it.
  it('trustFolder leaves a file it cannot parse exactly as it found it', async () => {
    for (const damaged of ['{"projects": {"/a": {"hasTrustDialogAcc', '', '[1,2,3]', '"text"', 'null']) {
      writeFileSync(join(TMP, '.claude.json'), damaged)
      const { trustFolder } = await import('../src/main/claude-config')
      trustFolder('/new/project')
      expect(readFileSync(join(TMP, '.claude.json'), 'utf-8'), JSON.stringify(damaged)).toBe(damaged)
    }
  })

  it('trustFolder leaves no temporary file behind', async () => {
    writeFileSync(join(TMP, '.claude.json'), JSON.stringify({ projects: {} }))
    const { trustFolder } = await import('../src/main/claude-config')
    trustFolder('/p')
    expect(readdirSync(TMP).filter((f) => f.startsWith('.claude.json'))).toEqual(['.claude.json'])
  })

  it('writeClaudeConfig refuses to replace a settings file it cannot parse', async () => {
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    const damaged = '{"permissions": {"allow": ["Bash(ls)"'
    writeFileSync(join(TMP, '.claude', 'settings.json'), damaged)
    const { writeClaudeConfig } = await import('../src/main/claude-config')
    expect(() => writeClaudeConfig('global', { effortLevel: 'high' })).toThrow(/settings\.json/)
    expect(readFileSync(join(TMP, '.claude', 'settings.json'), 'utf-8')).toBe(damaged)
  })

  it('writeClaudeConfig merges into an existing file and creates a missing one', async () => {
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    writeFileSync(join(TMP, '.claude', 'settings.json'), JSON.stringify({ keep: 1, permissions: { allow: ['a'], deny: ['b'] } }))
    const { writeClaudeConfig } = await import('../src/main/claude-config')
    writeClaudeConfig('global', { effortLevel: 'high', permissions: { allow: ['c'] } })
    expect(JSON.parse(readFileSync(join(TMP, '.claude', 'settings.json'), 'utf-8'))).toEqual({
      keep: 1, effortLevel: 'high', permissions: { allow: ['c'], deny: ['b'] },
    })
    writeClaudeConfig('local', { x: 1 })
    expect(JSON.parse(readFileSync(join(TMP, '.claude', 'settings.local.json'), 'utf-8'))).toEqual({ x: 1 })
  })
})
