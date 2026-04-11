import initSqlJs, { Database } from 'sql.js/dist/sql-asm.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, parse as parsePath } from 'path'

// ---------- drive-root helpers ----------

type PathStatus = 'ok' | 'missing' | 'unmounted'

function getEffectiveRoot(p: string): string {
  // macOS removable: /Volumes/X/foo → /Volumes/X
  if (process.platform === 'darwin' && p.startsWith('/Volumes/')) {
    const segs = p.split('/').filter(Boolean)
    if (segs.length >= 2) return '/' + segs[0] + '/' + segs[1]
  }
  // Linux removable: /media/X/foo or /mnt/X/foo → /media/X or /mnt/X
  if (process.platform === 'linux' && (p.startsWith('/media/') || p.startsWith('/mnt/'))) {
    const segs = p.split('/').filter(Boolean)
    if (segs.length >= 2) return '/' + segs[0] + '/' + segs[1]
  }
  // Default — Windows handles this perfectly:
  //   D:\2026\foo   → D:\
  //   \\srv\share\x → \\srv\share\
  // Unix non-removable: returns '/'
  return parsePath(p).root
}

function checkPathStatus(p: string): PathStatus {
  const root = getEffectiveRoot(p)
  if (!existsSync(root)) return 'unmounted'
  if (!existsSync(p)) return 'missing'
  return 'ok'
}

// Export helpers for unit testing
export { getEffectiveRoot, checkPathStatus }
export type { PathStatus }

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
    this.pruneStaleInternal()  // one-shot startup sweep
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

  async remove(folderPath: string): Promise<void> {
    await this.ready
    if (!this.db) return
    this.db.run('DELETE FROM recent_folders WHERE path = ?', [folderPath])
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

  /** Sweep all entries; delete any whose status is 'missing'.
   *  Entries with 'unmounted' status are kept untouched. */
  async pruneStale(): Promise<{ pruned: number }> {
    await this.ready
    return this.pruneStaleInternal()
  }

  /** Check a single path. Side effect: if 'missing', prunes that entry. */
  async checkPath(p: string): Promise<PathStatus> {
    await this.ready
    const status = checkPathStatus(p)
    if (status === 'missing' && this.db) {
      this.db.run('DELETE FROM recent_folders WHERE path = ?', [p])
      this.save()
    }
    return status
  }

  /** Internal version — skips the await on `ready` so init() can call it
   *  without self-deadlocking. */
  private pruneStaleInternal(): { pruned: number } {
    if (!this.db) return { pruned: 0 }
    const all = this.db.exec('SELECT path FROM recent_folders')
    if (all.length === 0) return { pruned: 0 }
    let pruned = 0
    for (const row of all[0].values) {
      const p = row[0] as string
      if (checkPathStatus(p) === 'missing') {
        this.db.run('DELETE FROM recent_folders WHERE path = ?', [p])
        pruned++
      }
    }
    if (pruned > 0) this.save()
    return { pruned }
  }

  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }
}
