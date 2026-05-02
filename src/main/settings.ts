import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { DEFAULT_AGENT_CLI, normalizeAgentCli, type AgentCli } from '../shared/agent-cli'

export interface AppSettings {
  editor: string
  defaultAgentCli: AgentCli
  claudeArgs: string
  codexArgs: string
  askBeforeLaunch: boolean
  defaultViewMode: 'grid' | 'focused'
  notifyOnIdle: boolean
  projectsRoot: string
  remoteAccess: boolean
  remotePort: number
  favoriteFolders: string[]
  restoreSessionEnabled: boolean
  autopilotApiProvider: 'anthropic' | 'openrouter'
  autopilotPlannerModel: string
  autopilotDefaultCostCap: number
  autopilotDefaultMaxIterations: number
}

const DEFAULTS: AppSettings = {
  editor: 'code',
  defaultAgentCli: DEFAULT_AGENT_CLI,
  claudeArgs: '',
  codexArgs: '',
  askBeforeLaunch: false,
  defaultViewMode: 'grid',
  notifyOnIdle: false,
  projectsRoot: '',
  remoteAccess: false,
  remotePort: 3456,
  favoriteFolders: [],
  restoreSessionEnabled: false,
  autopilotApiProvider: 'anthropic',
  autopilotPlannerModel: 'claude-sonnet-4-6',
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
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2))
    } catch {}
  }

  getAll(): AppSettings {
    return { ...this.settings }
  }
}
