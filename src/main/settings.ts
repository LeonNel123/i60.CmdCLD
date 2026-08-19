import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { dirname } from 'path'
import { DEFAULT_AGENT_CLI, normalizeAgentCli, type AgentCli } from '../shared/agent-cli'
import { DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE } from '../shared/terminal-font'
import { DEFAULT_APP_FONT_FAMILY } from '../shared/app-font'
import { DEFAULT_UI_SCALE_PCT } from '../shared/ui-scale'

export interface AppSettings {
  /** Global default editor id (empty = no global default chosen yet). */
  editor: string
  /** Per-project editor id overrides, keyed by absolute folder path. */
  editorByProject: Record<string, string>
  defaultAgentCli: AgentCli
  claudeArgs: string
  codexArgs: string
  grokArgs: string
  askBeforeLaunch: boolean
  defaultViewMode: 'grid' | 'focused'
  notifyOnIdle: boolean
  projectsRoot: string
  remoteAccess: boolean
  remotePort: number
  remoteLanAccess: boolean
  favoriteFolders: string[]
  restoreSessionEnabled: boolean
  restoreSessionResume: boolean
  terminalFontFamily: string
  terminalFontSize: number
  appFontFamily: string
  uiScalePct: number
  autopilotApiProvider: 'anthropic' | 'openrouter'
  autopilotPlannerModel: string
  autopilotDefaultCostCap: number
  autopilotDefaultMaxIterations: number
}

const DEFAULTS: AppSettings = {
  editor: '',
  editorByProject: {},
  defaultAgentCli: DEFAULT_AGENT_CLI,
  claudeArgs: '',
  codexArgs: '',
  grokArgs: '',
  askBeforeLaunch: false,
  defaultViewMode: 'grid',
  notifyOnIdle: false,
  projectsRoot: '',
  remoteAccess: false,
  remotePort: 3456,
  remoteLanAccess: false,
  favoriteFolders: [],
  restoreSessionEnabled: false,
  restoreSessionResume: false,
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  appFontFamily: DEFAULT_APP_FONT_FAMILY,
  uiScalePct: DEFAULT_UI_SCALE_PCT,
  autopilotApiProvider: 'anthropic',
  autopilotPlannerModel: 'claude-sonnet-5',
  autopilotDefaultCostCap: 1.0,
  autopilotDefaultMaxIterations: 40,
}

export class Settings {
  private settings: AppSettings
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    this.settings = this.load()
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        const merged = { ...DEFAULTS, ...raw }
        merged.defaultAgentCli = normalizeAgentCli(merged.defaultAgentCli)
        return merged
      }
    } catch {}
    return { ...DEFAULTS }
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      // Write-then-rename: load() silently falls back to defaults on unparseable
      // JSON, so a half-written file would quietly reset every setting. The
      // rename is atomic, so the real file only ever holds a complete write.
      const tmp = this.filePath + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.settings, null, 2))
      renameSync(tmp, this.filePath)
    } catch {}
  }

  getAll(): AppSettings {
    return { ...this.settings }
  }
}
