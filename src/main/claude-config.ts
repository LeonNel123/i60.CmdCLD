import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const settingsPath = (): string => join(homedir(), '.claude', 'settings.json')
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

// Enforce `disableBypassPermissionsMode: "disable"` in the user-level Claude
// settings. This blocks `--dangerously-skip-permissions` and Shift+Tab bypass
// mode so a user can't skip permission checks from within a CmdCLD-launched
// Claude session.
export function hardenGlobalSettings(): void {
  const path = settingsPath()
  const current = (readJson(path) as Record<string, unknown>) || {}
  const permissions = (current.permissions as Record<string, unknown>) || {}

  if (permissions.disableBypassPermissionsMode === 'disable' && !('skipDangerousModePermissionPrompt' in current)) {
    return
  }

  const next = { ...current }
  next.permissions = { ...permissions, disableBypassPermissionsMode: 'disable' }
  delete (next as Record<string, unknown>).skipDangerousModePermissionPrompt

  try {
    writeJson(path, next)
  } catch {
    // best-effort; we don't want to crash launch if the home dir is read-only
  }
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
