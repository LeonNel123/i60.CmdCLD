import Database from 'better-sqlite3'

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

export class RecentDB {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recent_folders (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_opened INTEGER NOT NULL
      )
    `)
  }

  add(folderPath: string): void {
    const name = folderPath.split(/[\\/]/).pop() || folderPath
    // Use max of current time and (latest entry + 1) to guarantee ordering
    const latest = this.db.prepare(
      'SELECT MAX(last_opened) as max FROM recent_folders'
    ).get() as { max: number | null }
    const now = Math.max(Date.now(), (latest?.max ?? 0) + 1)

    this.db.prepare(
      'INSERT OR REPLACE INTO recent_folders (path, name, last_opened) VALUES (?, ?, ?)'
    ).run(folderPath, name, now)

    // Prune to 20 most recent
    this.db.prepare(
      'DELETE FROM recent_folders WHERE path NOT IN (SELECT path FROM recent_folders ORDER BY last_opened DESC LIMIT 20)'
    ).run()
  }

  list(): RecentFolder[] {
    return this.db.prepare(
      'SELECT path, name, last_opened as lastOpened FROM recent_folders ORDER BY last_opened DESC LIMIT 20'
    ).all() as RecentFolder[]
  }

  close(): void {
    this.db.close()
  }
}
