import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const settingsPath = (): string => join(homedir(), '.claude', 'settings.json')
const settingsLocalPath = (): string => join(homedir(), '.claude', 'settings.local.json')
const claudeJsonPath = (): string => join(homedir(), '.claude.json')

type JsonObject = Record<string, unknown>

// These files belong to Claude Code, which rewrites them while it runs. A read
// can therefore land on a half-written or damaged file, and that is not the
// same as no file: 'missing' may be created, 'unreadable' must be left alone.
type ReadResult = { state: 'ok'; data: JsonObject } | { state: 'missing' } | { state: 'unreadable' }

function readJsonFile(path: string): ReadResult {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' }
  }
  try {
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'unreadable' }
    return { state: 'ok', data: data as JsonObject }
  } catch {
    return { state: 'unreadable' }
  }
}

function readJson(path: string): JsonObject | null {
  const r = readJsonFile(path)
  return r.state === 'ok' ? r.data : null
}

// Write beside the target and rename over it, so a reader (Claude Code) never
// sees a partial file and a crash mid-write leaves the old one intact.
function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.cmdcld-${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, path)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* nothing to clean up */ }
    throw e
  }
}

// Read both global and local Claude settings files for the UI
export function readClaudeConfig(): { global: Record<string, unknown>; local: Record<string, unknown> } {
  return {
    global: readJson(settingsPath()) || {},
    local: readJson(settingsLocalPath()) || {},
  }
}

// Write back the global or local settings, preserving fields the UI doesn't edit
export function writeClaudeConfig(scope: 'global' | 'local', data: Record<string, unknown>): void {
  const path = scope === 'global' ? settingsPath() : settingsLocalPath()
  const read = readJsonFile(path)
  if (read.state === 'unreadable') {
    throw new Error(`${path} could not be read as JSON; it was left unchanged`)
  }
  const current = read.state === 'ok' ? read.data : {}
  const merged = { ...current, ...data }
  // If permissions was updated, merge it properly
  if (data.permissions && current.permissions) {
    merged.permissions = { ...(current.permissions as Record<string, unknown>), ...(data.permissions as Record<string, unknown>) }
  }
  writeJson(path, merged)
}

// Previously enforced `disableBypassPermissionsMode: "disable"` in the
// user-level Claude settings.  Now a no-op — we let the user control their
// own permission mode via the CLI settings or the in-app presets.
export function hardenGlobalSettings(): void {
  // intentionally empty — kept as a callable so callers don't need to change
}

// Pre-accept the Claude trust prompt for a folder so the first launch doesn't
// block on "do you trust the files in this folder". Claude stores this under
// `projects[folderPath].hasTrustDialogAccepted` in `~/.claude.json`.
export function trustFolder(folderPath: string): void {
  if (!folderPath) return
  try {
    const path = claudeJsonPath()
    const read = readJsonFile(path)
    // Unreadable right now (mid-write, damaged): do nothing. Claude asks its
    // trust question once; rewriting the file would cost every other project.
    if (read.state === 'unreadable') return
    const current = read.state === 'ok' ? read.data : {}
    const projects = (current.projects as Record<string, Record<string, unknown>>) || {}
    const existing = projects[folderPath] || {}
    if (existing.hasTrustDialogAccepted === true) return

    projects[folderPath] = { ...existing, hasTrustDialogAccepted: true }
    const next = { ...current, projects }
    writeJson(path, next)
  } catch {
    // best-effort; Claude will fall back to prompting
  }
}
