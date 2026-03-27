import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface AppSettings {
  editor: string
  claudeArgs: string
  askBeforeLaunch: boolean
  defaultViewMode: 'grid' | 'focused'
  notifyOnIdle: boolean
  projectsRoot: string
}

const DEFAULTS: AppSettings = {
  editor: 'code',
  claudeArgs: '--dangerously-skip-permissions',
  askBeforeLaunch: false,
  defaultViewMode: 'grid',
  notifyOnIdle: false,
  projectsRoot: '',
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
        return { ...DEFAULTS, ...raw }
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
