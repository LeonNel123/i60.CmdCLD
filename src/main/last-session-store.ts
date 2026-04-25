import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs'
import { dirname } from 'path'

export interface SavedProject {
  path: string
  claudeArgs: string
  isPlainShell: boolean
}

export interface SavedSession {
  savedAt: number
  projects: SavedProject[]
}

// Best-effort JSON store for the last open session. Never throws — silent
// recovery is the contract because session restore is a UX nicety, not a
// guarantee. Atomic writes via tmp + rename so a crash mid-write does not
// corrupt the file.
export class LastSessionStore {
  constructor(private readonly filePath: string) {}

  read(): SavedSession | null {
    try {
      if (!existsSync(this.filePath)) return null
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.projects)) return null
      if (typeof parsed.savedAt !== 'number') return null
      return parsed as SavedSession
    } catch {
      return null
    }
  }

  write(session: SavedSession): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmp = this.filePath + '.tmp'
      writeFileSync(tmp, JSON.stringify(session, null, 2))
      renameSync(tmp, this.filePath)
    } catch {
      // best-effort
    }
  }

  clear(): void {
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath)
    } catch {
      // best-effort
    }
  }
}
