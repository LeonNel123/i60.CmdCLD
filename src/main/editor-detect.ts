import { execFileSync } from 'child_process'

export interface EditorInfo {
  id: string
  name: string
  cmd: string
}

const KNOWN_EDITORS: EditorInfo[] = [
  { id: 'code', name: 'VS Code', cmd: 'code' },
  { id: 'cursor', name: 'Cursor', cmd: 'cursor' },
  { id: 'windsurf', name: 'Windsurf', cmd: 'windsurf' },
  { id: 'zed', name: 'Zed', cmd: 'zed' },
  { id: 'devenv', name: 'Visual Studio', cmd: 'devenv' },
  { id: 'idea', name: 'IntelliJ IDEA', cmd: 'idea' },
  { id: 'webstorm', name: 'WebStorm', cmd: 'webstorm' },
  { id: 'sublime', name: 'Sublime Text', cmd: 'subl' },
  { id: 'notepad++', name: 'Notepad++', cmd: 'notepad++' },
]

function isAvailable(cmd: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(which, [cmd], { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export function detectEditors(): EditorInfo[] {
  return KNOWN_EDITORS.filter((e) => isAvailable(e.cmd))
}

export function getDefaultEditor(available: EditorInfo[]): EditorInfo | undefined {
  // Prefer in order: code, cursor, windsurf, then whatever's first
  for (const preferred of ['code', 'cursor', 'windsurf']) {
    const found = available.find((e) => e.id === preferred)
    if (found) return found
  }
  return available[0]
}
