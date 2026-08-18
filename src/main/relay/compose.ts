// Compose-and-send: the relay dialog's authoring path. The human types an ask;
// this turns it into a proper exchange document in the domain hub's outbound/
// (thread-named per the exchange skill), commits and pushes the hub, and then
// the caller relays a nudge pointing at the committed file. Documents stay the
// protocol; this just removes the manual file-creation step.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

const execFileP = promisify(execFile)

// Thread-name slug from the subject: lowercase kebab, bounded, never empty.
export function slugify(subject: string): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug || 'request'
}

// Repo codes live in the hub's REPOS.md tables: rows like
//   | `CMDCLD` | CmdCLD | ... |
// Returns code keyed by lowercased repo display name, plus the raw code set.
export function parseRepoCodes(reposMd: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of reposMd.split(/\r?\n/)) {
    const m = /^\|\s*`([A-Z0-9]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line)
    if (!m) continue
    const code = m[1]
    map.set(code.toLowerCase(), code)
    // Display name may carry a parenthetical ("Bravo (bravo-reimagined)") —
    // register both forms.
    const name = m[2]
    map.set(name.toLowerCase(), code)
    const paren = /^(.*?)\s*\((.*?)\)\s*$/.exec(name)
    if (paren) {
      map.set(paren[1].trim().toLowerCase(), code)
      map.set(paren[2].trim().toLowerCase(), code)
    }
  }
  return map
}

// Best-effort code for a session: exact code, exact repo name, then a
// substring match either way; falls back to the uppercased session name so a
// missing registry row degrades to a readable name instead of an error.
export function resolveCode(sessionOrRepoName: string, codes: Map<string, string>): string {
  const needle = sessionOrRepoName.trim().toLowerCase()
  const exact = codes.get(needle)
  if (exact) return exact
  for (const [name, code] of codes) {
    if (name.includes(needle) || needle.includes(name)) return code
  }
  return sessionOrRepoName.replace(/[^A-Za-z0-9]+/g, '').toUpperCase() || 'UNKNOWN'
}

export function composeFileName(fromCode: string, toCode: string, date: Date, subject: string): string {
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `${fromCode}-to-${toCode}-REQ-${ymd}-${slugify(subject)}.md`
}

export function renderDocument(opts: {
  fileTitle: string
  fromName: string
  fromCode: string
  date: Date
  body: string
}): string {
  const iso = opts.date.toISOString().slice(0, 10)
  return `# ${opts.fileTitle.replace(/\.md$/, '')}\n\n` +
    `*From: ${opts.fromName} (\`${opts.fromCode}\`) — ${iso}. Composed in the CmdCLD relay.*\n\n` +
    `${opts.body.trim()}\n`
}

export interface ComposeRequest {
  hubClone: string
  fromName: string
  fromProjectPath: string
  // Target as typed: session name, or name@MACHINE.
  to: string
  subject: string
  body: string
}

export interface ComposeResult {
  ok: boolean
  path?: string
  fileName?: string
  error?: string
}

// Writes, commits, and pushes the document. Pull first — the hub is
// multi-writer and a document does not exist until pushed.
export async function composeInHub(req: ComposeRequest, now: () => number = Date.now): Promise<ComposeResult> {
  const outbound = join(req.hubClone, 'outbound')
  if (!existsSync(outbound) || !existsSync(join(req.hubClone, 'REPOS.md'))) {
    return { ok: false, error: 'selected folder is not an exchange hub clone (needs outbound/ and REPOS.md)' }
  }
  if (!req.subject.trim()) return { ok: false, error: 'subject is empty' }
  if (!req.body.trim()) return { ok: false, error: 'message is empty' }

  const codes = parseRepoCodes(readFileSync(join(req.hubClone, 'REPOS.md'), 'utf8'))
  const fromCode = resolveCode(basename(req.fromProjectPath) || req.fromName, codes)
  const toCode = resolveCode(req.to.replace(/@[^@]*$/, ''), codes)
  const date = new Date(now())

  let fileName = composeFileName(fromCode, toCode, date, req.subject)
  if (existsSync(join(outbound, fileName))) {
    // Same four-field key twice in a day: the later author appends -b (rule 4).
    fileName = fileName.replace(/\.md$/, '-b.md')
    if (existsSync(join(outbound, fileName))) {
      return { ok: false, error: `both ${fileName.replace(/-b\.md$/, '.md')} and its -b variant exist — pick a different subject` }
    }
  }
  const filePath = join(outbound, fileName)

  const git = async (...args: string[]): Promise<void> => {
    await execFileP('git', args, { cwd: req.hubClone, windowsHide: true })
  }
  try {
    try { await git('pull', '--rebase', '--quiet') } catch { /* offline: commit locally, push will fail loudly */ }
    writeFileSync(filePath, renderDocument({
      fileTitle: fileName, fromName: req.fromName, fromCode, date, body: req.body,
    }))
    await git('add', join('outbound', fileName))
    await git('commit', '-q', '-m', `${fromCode} to ${toCode}: ${slugify(req.subject)}`)
    await git('push', '-q')
  } catch (err) {
    return { ok: false, error: `hub commit/push failed: ${(err as Error).message}` }
  }
  return { ok: true, path: filePath, fileName }
}
