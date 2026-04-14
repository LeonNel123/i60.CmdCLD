import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
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
})
