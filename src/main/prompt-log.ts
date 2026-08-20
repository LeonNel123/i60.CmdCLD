import initSqlJs, { Database } from 'sql.js/dist/sql-asm.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { dirname } from 'path'

/** One broadcast, as it was actually dispatched. */
export interface PromptRecord {
  id: number
  sentAt: number
  /** Console labels the prompt went to, e.g. ["api (Claude)", "web (Codex)"]. */
  targets: string[]
  /** Project folder paths behind those consoles, for replaying elsewhere. */
  projects: string[]
  /** What the author typed. Always stored, even when a rewrite replaced it. */
  originalText: string
  /** The rewrite that was sent, or null when sent as-is. */
  refinedText: string | null
  /** Model that produced refinedText, null when not refined. */
  model: string | null
  /** Wall-clock ms the refine call took, null when not refined. */
  refineMs: number | null
  /** False when every target failed to receive it. */
  ok: boolean
}

export type NewPrompt = Omit<PromptRecord, 'id'>

/** The text that actually reached the agents. */
export function sentTextOf(p: Pick<PromptRecord, 'originalText' | 'refinedText'>): string {
  return p.refinedText ?? p.originalText
}

const MAX_ROWS = 500

/**
 * Broadcast prompt history, in its own database file.
 *
 * Deliberately not a table inside recent.db: sql.js has no incremental write, so every
 * save rewrites the whole file. Putting a log that grows to hundreds of rows next to the
 * recent-folders table would make every folder click pay for it.
 */
export class PromptLog {
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
      this.db = existsSync(this.dbPath)
        ? new SQL.Database(readFileSync(this.dbPath))
        : new SQL.Database()
    } catch {
      // A corrupt file must not take the app down; start clean rather than throw.
      this.db = new SQL.Database()
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sent_at INTEGER NOT NULL,
        targets TEXT NOT NULL,
        projects TEXT NOT NULL,
        original_text TEXT NOT NULL,
        refined_text TEXT,
        model TEXT,
        refine_ms INTEGER,
        ok INTEGER NOT NULL DEFAULT 1
      )
    `)
    this.save()
  }

  private save(): void {
    if (!this.db) return
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true })
      // Write-then-rename: a crash mid-write leaves the previous file intact rather
      // than a truncated database.
      const tmp = this.dbPath + '.tmp'
      writeFileSync(tmp, Buffer.from(this.db.export()))
      renameSync(tmp, this.dbPath)
    } catch {}
  }

  async add(p: NewPrompt): Promise<number> {
    await this.ready
    if (!this.db) return -1
    this.db.run(
      `INSERT INTO broadcast_prompts
       (sent_at, targets, projects, original_text, refined_text, model, refine_ms, ok)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.sentAt, JSON.stringify(p.targets), JSON.stringify(p.projects), p.originalText,
       p.refinedText, p.model, p.refineMs, p.ok ? 1 : 0],
    )
    const idRes = this.db.exec('SELECT last_insert_rowid()')
    const id = idRes.length ? Number(idRes[0].values[0][0]) : -1
    this.db.run(
      `DELETE FROM broadcast_prompts WHERE id NOT IN
       (SELECT id FROM broadcast_prompts ORDER BY sent_at DESC, id DESC LIMIT ?)`,
      [MAX_ROWS],
    )
    this.save()
    return id
  }

  async list(limit = 100, offset = 0): Promise<PromptRecord[]> {
    await this.ready
    if (!this.db) return []
    // sql.js types exec() without bind params, so this goes through a prepared
    // statement rather than interpolating the numbers into the SQL.
    const stmt = this.db.prepare(
      `SELECT id, sent_at, targets, projects, original_text, refined_text, model, refine_ms, ok
       FROM broadcast_prompts ORDER BY sent_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    const out: PromptRecord[] = []
    try {
      stmt.bind([limit, offset])
      while (stmt.step()) out.push(rowToRecord(stmt.get() as unknown[]))
    } finally {
      stmt.free()
    }
    return out
  }

  async remove(id: number): Promise<void> {
    await this.ready
    if (!this.db) return
    this.db.run('DELETE FROM broadcast_prompts WHERE id = ?', [id])
    this.save()
  }

  async clear(): Promise<void> {
    await this.ready
    if (!this.db) return
    this.db.run('DELETE FROM broadcast_prompts')
    this.save()
  }

  async count(): Promise<number> {
    await this.ready
    if (!this.db) return 0
    const res = this.db.exec('SELECT COUNT(*) FROM broadcast_prompts')
    return res.length ? Number(res[0].values[0][0]) : 0
  }
}

function parseList(v: unknown): string[] {
  if (typeof v !== 'string') return []
  try {
    const j = JSON.parse(v)
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function rowToRecord(r: unknown[]): PromptRecord {
  return {
    id: Number(r[0]),
    sentAt: Number(r[1]),
    targets: parseList(r[2]),
    projects: parseList(r[3]),
    originalText: String(r[4] ?? ''),
    refinedText: r[5] == null ? null : String(r[5]),
    model: r[6] == null ? null : String(r[6]),
    refineMs: r[7] == null ? null : Number(r[7]),
    ok: Number(r[8]) === 1,
  }
}
