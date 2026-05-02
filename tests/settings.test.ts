import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Settings } from '../src/main/settings'

const TMP = join(__dirname, '.tmp-settings-test')
const FILE = join(TMP, 'settings.json')

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('Settings agent CLI defaults', () => {
  it('defaults legacy settings to Claude while adding Codex fields', () => {
    writeFileSync(FILE, JSON.stringify({ claudeArgs: '--continue' }))
    const settings = new Settings(FILE)

    expect(settings.get('defaultAgentCli')).toBe('claude')
    expect(settings.get('claudeArgs')).toBe('--continue')
    expect(settings.get('codexArgs')).toBe('')
  })

  it('persists the selected default agent and Codex args', () => {
    const settings = new Settings(FILE)
    settings.set('defaultAgentCli', 'codex')
    settings.set('codexArgs', '--sandbox workspace-write')

    const reloaded = new Settings(FILE)
    expect(reloaded.get('defaultAgentCli')).toBe('codex')
    expect(reloaded.get('codexArgs')).toBe('--sandbox workspace-write')
  })
})
