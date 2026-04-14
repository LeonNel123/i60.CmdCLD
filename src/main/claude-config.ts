import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const settingsPath = (): string => join(homedir(), '.claude', 'settings.json')
const settingsLocalPath = (): string => join(homedir(), '.claude', 'settings.local.json')
const claudeJsonPath = (): string => join(homedir(), '.claude.json')

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
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
  const current = readJson(path) || {}
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
    const current = (readJson(path) as Record<string, unknown>) || {}
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
