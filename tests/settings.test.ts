import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Settings } from '../src/main/settings'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  clampTerminalFontSize,
  pointsToPixels,
  resolveTerminalFontFamily,
} from '../src/shared/terminal-font'
import { DEFAULT_APP_FONT_FAMILY, resolveAppFontFamily } from '../src/shared/app-font'

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

describe('Settings terminal font', () => {
  it('defaults a legacy settings file to the Windows Terminal font (Cascadia Mono, 12)', () => {
    writeFileSync(FILE, JSON.stringify({ claudeArgs: '--continue' }))
    const settings = new Settings(FILE)

    expect(settings.get('terminalFontFamily')).toBe(DEFAULT_TERMINAL_FONT_FAMILY)
    expect(settings.get('terminalFontFamily')).toContain('Cascadia Mono')
    expect(settings.get('terminalFontSize')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(settings.get('terminalFontSize')).toBe(12)
  })

  it('persists a custom terminal font family and size', () => {
    const settings = new Settings(FILE)
    settings.set('terminalFontFamily', 'Fira Code, monospace')
    settings.set('terminalFontSize', 16)

    const reloaded = new Settings(FILE)
    expect(reloaded.get('terminalFontFamily')).toBe('Fira Code, monospace')
    expect(reloaded.get('terminalFontSize')).toBe(16)
  })
})

describe('Settings interface (app) font', () => {
  it('defaults a legacy settings file to the Cascadia Mono interface font', () => {
    writeFileSync(FILE, JSON.stringify({ claudeArgs: '--continue' }))
    const settings = new Settings(FILE)

    expect(settings.get('appFontFamily')).toBe(DEFAULT_APP_FONT_FAMILY)
    expect(settings.get('appFontFamily')).toContain('Cascadia Mono')
  })

  it('persists a custom interface font family', () => {
    const settings = new Settings(FILE)
    settings.set('appFontFamily', 'Inter, sans-serif')

    const reloaded = new Settings(FILE)
    expect(reloaded.get('appFontFamily')).toBe('Inter, sans-serif')
  })
})

describe('resolveAppFontFamily', () => {
  it('keeps a non-empty family and falls back for blank/undefined', () => {
    expect(resolveAppFontFamily('Inter, sans-serif')).toBe('Inter, sans-serif')
    expect(resolveAppFontFamily('   ')).toBe(DEFAULT_APP_FONT_FAMILY)
    expect(resolveAppFontFamily(undefined)).toBe(DEFAULT_APP_FONT_FAMILY)
    expect(resolveAppFontFamily(null)).toBe(DEFAULT_APP_FONT_FAMILY)
  })
})

describe('clampTerminalFontSize', () => {
  it('rounds and clamps into the supported range', () => {
    expect(clampTerminalFontSize(14)).toBe(14)
    expect(clampTerminalFontSize(13.6)).toBe(14)
    expect(clampTerminalFontSize(0)).toBe(TERMINAL_FONT_SIZE_MIN)
    expect(clampTerminalFontSize(999)).toBe(TERMINAL_FONT_SIZE_MAX)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampTerminalFontSize(NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(Infinity)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
  })
})

describe('pointsToPixels', () => {
  it('converts the stored point size to CSS pixels for xterm (x 4/3)', () => {
    // Windows Terminal's 12pt default must render as 16 CSS px.
    expect(pointsToPixels(DEFAULT_TERMINAL_FONT_SIZE)).toBe(16)
    expect(pointsToPixels(12)).toBe(16)
    expect(pointsToPixels(9)).toBe(12)
    expect(pointsToPixels(24)).toBe(32)
  })

  it('rounds to a whole pixel and falls back for non-finite input', () => {
    expect(pointsToPixels(13)).toBe(17) // 17.33 -> 17
    expect(pointsToPixels(NaN)).toBe(pointsToPixels(DEFAULT_TERMINAL_FONT_SIZE))
  })
})

describe('resolveTerminalFontFamily', () => {
  it('keeps a non-empty family and falls back for blank/undefined', () => {
    expect(resolveTerminalFontFamily('Consolas')).toBe('Consolas')
    expect(resolveTerminalFontFamily('   ')).toBe(DEFAULT_TERMINAL_FONT_FAMILY)
    expect(resolveTerminalFontFamily(undefined)).toBe(DEFAULT_TERMINAL_FONT_FAMILY)
    expect(resolveTerminalFontFamily(null)).toBe(DEFAULT_TERMINAL_FONT_FAMILY)
  })
})
