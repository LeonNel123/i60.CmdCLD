import initSqlJs, { Database } from 'sql.js/dist/sql-asm.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

export class RecentDB {
  private db: Database | null = null
  private dbPath: string
  private ready: Promise<void>

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const SQL = await initSqlJs()

    try {
      if (existsSync(this.dbPath)) {
        const buffer = readFileSync(this.dbPath)
        this.db = new SQL.Database(buffer)
      } else {
        this.db = new SQL.Database()
      }
    } catch {
      this.db = new SQL.Database()
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS recent_folders (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_opened INTEGER NOT NULL
      )
    `)
    this.save()
  }

  private save(): void {
    if (!this.db) return
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true })
      const data = this.db.export()
      writeFileSync(this.dbPath, Buffer.from(data))
    } catch {}
  }

  async add(folderPath: string): Promise<void> {
    await this.ready
    if (!this.db) return

    // Use max of current time and (latest entry + 1) to guarantee ordering
    const result = this.db.exec('SELECT MAX(last_opened) as max FROM recent_folders')
    const maxTs = result.length > 0 && result[0].values[0][0] != null
      ? (result[0].values[0][0] as number)
      : 0
    const now = Math.max(Date.now(), maxTs + 1)
    const name = folderPath.split(/[\\/]/).pop() || folderPath

    this.db.run(
      'INSERT OR REPLACE INTO recent_folders (path, name, last_opened) VALUES (?, ?, ?)',
      [folderPath, name, now]
    )

    // Prune to 20 most recent
    this.db.run(
      'DELETE FROM recent_folders WHERE path NOT IN (SELECT path FROM recent_folders ORDER BY last_opened DESC LIMIT 20)'
    )

    this.save()
  }

  async list(): Promise<RecentFolder[]> {
    await this.ready
    if (!this.db) return []

    const result = this.db.exec(
      'SELECT path, name, last_opened FROM recent_folders ORDER BY last_opened DESC LIMIT 20'
    )
    if (result.length === 0) return []

    return result[0].values.map((row) => ({
      path: row[0] as string,
      name: row[1] as string,
      lastOpened: row[2] as number,
    }))
  }

  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }
}
