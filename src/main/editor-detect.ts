import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export interface EditorInfo {
  id: string
  name: string
  /**
   * The command used to launch the editor on a folder. Either an absolute path
   * (resolved from a known install location — preferred, so launching does not
   * depend on PATH) or a bare command name found on PATH.
   */
  cmd: string
}

interface KnownEditor {
  id: string
  name: string
  /** Bare command name, looked up on PATH as a fallback. */
  bin: string
  /**
   * Absolute install-location candidates, checked before PATH. Support `${env}`
   * placeholders for environment variables. First existing file wins.
   */
  winPaths?: string[]
  macPaths?: string[]
}

// Folder-capable editors: given a directory, they open it as a workspace. This
// is the app's common case (a CLI agent session rooted at a folder). Visual
// Studio is detected separately (detectVisualStudio, via vswhere) and appended
// as a first-class folder-opener too — it just needs a different lookup than a
// PATH/install-path probe. Note VS is ALSO the target for solution/project files
// opened through the OS association (findProjectAnchor + shell.openPath).
const KNOWN_EDITORS: KnownEditor[] = [
  {
    id: 'code', name: 'VS Code', bin: 'code',
    winPaths: [
      '${LOCALAPPDATA}\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      '${ProgramFiles}\\Microsoft VS Code\\bin\\code.cmd',
      '${ProgramFiles(x86)}\\Microsoft VS Code\\bin\\code.cmd',
    ],
    macPaths: ['/usr/local/bin/code', '/opt/homebrew/bin/code'],
  },
  {
    id: 'cursor', name: 'Cursor', bin: 'cursor',
    winPaths: [
      '${LOCALAPPDATA}\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd',
      '${LOCALAPPDATA}\\Programs\\Cursor\\resources\\app\\bin\\cursor.cmd',
    ],
    macPaths: ['/usr/local/bin/cursor', '/opt/homebrew/bin/cursor'],
  },
  {
    id: 'windsurf', name: 'Windsurf', bin: 'windsurf',
    winPaths: [
      '${LOCALAPPDATA}\\Programs\\Windsurf\\bin\\windsurf.cmd',
    ],
    macPaths: ['/usr/local/bin/windsurf', '/opt/homebrew/bin/windsurf'],
  },
  {
    id: 'zed', name: 'Zed', bin: 'zed',
    winPaths: [
      '${LOCALAPPDATA}\\Programs\\Zed\\zed.exe',
    ],
    macPaths: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'],
  },
  {
    id: 'sublime', name: 'Sublime Text', bin: 'subl',
    winPaths: [
      '${ProgramFiles}\\Sublime Text\\subl.exe',
      '${ProgramFiles}\\Sublime Text 3\\subl.exe',
    ],
    macPaths: ['/usr/local/bin/subl', '/opt/homebrew/bin/subl'],
  },
]

function expandEnv(p: string): string | null {
  let missing = false
  const out = p.replace(/\$\{([^}]+)\}/g, (_m, name: string) => {
    const v = process.env[name]
    if (v == null || v === '') { missing = true; return '' }
    return v
  })
  return missing ? null : out
}

function onPath(bin: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(which, [bin], { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a launch command for one editor, preferring an absolute path from a
 * known install location (so launching does not depend on PATH) and falling
 * back to the bare command name if it is on PATH. Returns null if not found.
 */
function resolveEditor(e: KnownEditor): EditorInfo | null {
  const candidates = process.platform === 'win32' ? e.winPaths : e.macPaths
  for (const raw of candidates ?? []) {
    const full = expandEnv(raw)
    if (full && existsSync(full)) return { id: e.id, name: e.name, cmd: full }
  }
  if (onPath(e.bin)) return { id: e.id, name: e.name, cmd: e.bin }
  return null
}

/**
 * Detect Visual Studio via vswhere (installed at a fixed path with every VS
 * 2017+). Returns devenv.exe as a folder-capable editor — `devenv <folder>`
 * opens the folder in VS. Null on non-Windows or when VS isn't installed.
 */
function detectVisualStudio(): EditorInfo | null {
  if (process.platform !== 'win32') return null
  const vswhere = expandEnv('${ProgramFiles(x86)}\\Microsoft Visual Studio\\Installer\\vswhere.exe')
  if (!vswhere || !existsSync(vswhere)) return null
  try {
    const productPath = execFileSync(vswhere, ['-latest', '-property', 'productPath'], { encoding: 'utf8', timeout: 5000 }).trim()
    if (!productPath || !existsSync(productPath)) return null
    let name = 'Visual Studio'
    try {
      const displayName = execFileSync(vswhere, ['-latest', '-property', 'displayName'], { encoding: 'utf8', timeout: 5000 }).trim()
      if (displayName) name = displayName
    } catch { /* keep generic name */ }
    return { id: 'devenv', name, cmd: productPath }
  } catch {
    return null
  }
}

export function detectEditors(): EditorInfo[] {
  const editors = KNOWN_EDITORS.map(resolveEditor).filter((e): e is EditorInfo => e !== null)
  const vs = detectVisualStudio()
  return vs ? [...editors, vs] : editors
}

export function getDefaultEditor(available: EditorInfo[]): EditorInfo | undefined {
  // Prefer in order: code, cursor, windsurf, then whatever's first
  for (const preferred of ['code', 'cursor', 'windsurf']) {
    const found = available.find((e) => e.id === preferred)
    if (found) return found
  }
  return available[0]
}

export interface ProjectAnchor {
  path: string
  name: string
  kind: 'solution' | 'project'
}

// Opened via the OS file association (shell.openPath), which on Windows routes
// .sln/.csproj to VSLauncher → the correct Visual Studio. A solution always
// wins over a bare project file, and a project file only anchors when there is
// no solution.
const SOLUTION_EXTS = ['.sln', '.slnx']
const PROJECT_EXTS = ['.csproj', '.fsproj', '.vbproj']

/**
 * Look for a Visual Studio solution (or, failing that, a single project file)
 * at the top level of a folder. Returns null if the folder isn't a VS project
 * root. Only the top level is scanned — solutions live at the repo root.
 */
export function findProjectAnchor(folder: string): ProjectAnchor | null {
  let entries: string[]
  try {
    entries = readdirSync(folder)
  } catch {
    return null
  }
  const lower = (ext: string) => (f: string) => f.toLowerCase().endsWith(ext)

  for (const ext of SOLUTION_EXTS) {
    const hit = entries.find(lower(ext))
    if (hit) return { path: join(folder, hit), name: hit, kind: 'solution' }
  }
  const projects = entries.filter((f) => PROJECT_EXTS.some((ext) => f.toLowerCase().endsWith(ext)))
  if (projects.length > 0) return { path: join(folder, projects[0]), name: projects[0], kind: 'project' }
  return null
}
