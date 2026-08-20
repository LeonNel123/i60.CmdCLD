import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'

export interface TerminalCandidate {
  id: string
  name: string
  /** Executable to launch. Absolute where a known install path exists. */
  cmd: string
  /** Arguments before the working directory is applied. */
  args: string[]
  /**
   * True when the terminal needs the folder passed as an argument rather than
   * inherited as the child's cwd.
   */
  passesFolderAsArg?: boolean
}

function expandEnv(p: string): string | null {
  let missing = false
  const out = p.replace(/\$\{([^}]+)\}/g, (_m, name: string) => {
    const v = process.env[name]
    if (v == null || v === '') { missing = true; return '' }
    return v
  })
  return missing ? null : out
}

/**
 * Terminals this platform can open, best first.
 *
 * Most entries take no folder argument at all: the child is spawned with `cwd` set to the
 * target folder and simply inherits it. That sidesteps quoting entirely — a path
 * containing a space, an ampersand or a quote never has to survive a shell's parser,
 * which is where this kind of feature usually breaks.
 */
export function detectTerminals(): TerminalCandidate[] {
  if (process.platform === 'win32') {
    const found: TerminalCandidate[] = []
    // Windows Terminal, when installed, is the one people mean.
    const wt = expandEnv('${LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe')
    if (wt && existsSync(wt)) {
      found.push({ id: 'wt', name: 'Windows Terminal', cmd: wt, args: [] })
    }
    const pwsh = expandEnv('${ProgramFiles}\\PowerShell\\7\\pwsh.exe')
    if (pwsh && existsSync(pwsh)) {
      found.push({ id: 'pwsh', name: 'PowerShell 7', cmd: pwsh, args: ['-NoLogo', '-NoExit'] })
    }
    const ps = expandEnv('${SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    if (ps && existsSync(ps)) {
      found.push({ id: 'powershell', name: 'Windows PowerShell', cmd: ps, args: ['-NoLogo', '-NoExit'] })
    }
    const cmdExe = expandEnv('${SystemRoot}\\System32\\cmd.exe')
    if (cmdExe && existsSync(cmdExe)) {
      found.push({ id: 'cmd', name: 'Command Prompt', cmd: cmdExe, args: ['/K'] })
    }
    return found
  }

  if (process.platform === 'darwin') {
    // `open -a` hands the folder to the app, which opens a shell there. Terminal.app is
    // always present; iTerm only when installed.
    const out: TerminalCandidate[] = []
    if (existsSync('/Applications/iTerm.app')) {
      out.push({ id: 'iterm', name: 'iTerm', cmd: 'open', args: ['-a', 'iTerm'], passesFolderAsArg: true })
    }
    out.push({ id: 'terminal', name: 'Terminal', cmd: 'open', args: ['-a', 'Terminal'], passesFolderAsArg: true })
    return out
  }

  // Linux: whichever of the usual emulators exists. All inherit cwd.
  const linux: Array<[string, string, string]> = [
    ['/usr/bin/x-terminal-emulator', 'x-terminal-emulator', 'Terminal'],
    ['/usr/bin/gnome-terminal', 'gnome-terminal', 'GNOME Terminal'],
    ['/usr/bin/konsole', 'konsole', 'Konsole'],
    ['/usr/bin/xfce4-terminal', 'xfce4-terminal', 'Xfce Terminal'],
    ['/usr/bin/alacritty', 'alacritty', 'Alacritty'],
  ]
  return linux
    .filter(([p]) => existsSync(p))
    .map(([p, id, name]) => ({ id, name, cmd: p, args: [] }))
}

export interface LaunchResult {
  ok: boolean
  name?: string
  error?: string
}

/**
 * Open an external terminal at `folderPath`.
 *
 * Detached and unref'd so it outlives CmdCLD — the point is a shell the user keeps using
 * after closing the app, not a child that dies with it.
 */
export function openExternalTerminal(folderPath: string, preferredId?: string): LaunchResult {
  try {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
      return { ok: false, error: 'Folder no longer exists' }
    }
  } catch {
    return { ok: false, error: 'Folder no longer exists' }
  }

  const candidates = detectTerminals()
  if (candidates.length === 0) return { ok: false, error: 'No terminal application found' }

  const chosen = (preferredId && candidates.find((c) => c.id === preferredId)) || candidates[0]
  const args = chosen.passesFolderAsArg ? [...chosen.args, folderPath] : chosen.args

  try {
    const child = spawn(chosen.cmd, args, {
      // Inheriting cwd is what keeps the path out of any shell's parser.
      cwd: chosen.passesFolderAsArg ? undefined : folderPath,
      detached: true,
      stdio: 'ignore',
      // The whole point is a visible window, so this must not be hidden.
      windowsHide: false,
    })
    child.unref()
    return { ok: true, name: chosen.name }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Exported for tests: where a Windows candidate would be looked up. */
export function windowsCandidatePath(which: 'wt' | 'pwsh' | 'powershell' | 'cmd'): string | null {
  const map = {
    wt: '${LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe',
    pwsh: '${ProgramFiles}\\PowerShell\\7\\pwsh.exe',
    powershell: '${SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    cmd: '${SystemRoot}\\System32\\cmd.exe',
  }
  return expandEnv(map[which])
}

