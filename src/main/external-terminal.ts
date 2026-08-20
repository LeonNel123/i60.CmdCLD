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
  /**
   * True for a console application (a shell) as opposed to a terminal window that
   * hosts one. Windows gives a detached console app no console at all, so these have
   * to be launched a different way — see buildLaunchPlan.
   */
  needsConsole?: boolean
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
      found.push({ id: 'pwsh', name: 'PowerShell 7', cmd: pwsh, args: ['-NoLogo', '-NoExit'], needsConsole: true })
    }
    const ps = expandEnv('${SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    if (ps && existsSync(ps)) {
      found.push({ id: 'powershell', name: 'Windows PowerShell', cmd: ps, args: ['-NoLogo', '-NoExit'], needsConsole: true })
    }
    const cmdExe = expandEnv('${SystemRoot}\\System32\\cmd.exe')
    if (cmdExe && existsSync(cmdExe)) {
      found.push({ id: 'cmd', name: 'Command Prompt', cmd: cmdExe, args: ['/K'], needsConsole: true })
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

export interface LaunchPlan {
  cmd: string
  args: string[]
  /** Undefined only for candidates that take the folder as an argument instead. */
  cwd?: string
}

/**
 * What to actually spawn for a chosen candidate.
 *
 * The Windows detour exists because of how `detached: true` behaves there: Node maps it
 * to DETACHED_PROCESS, which gives the child *no* console rather than a new one. A GUI
 * terminal like Windows Terminal does not care — it draws its own window. A console
 * application does: powershell.exe with nowhere to draw reads EOF from its NUL stdin and
 * exits within milliseconds, and since spawn() itself succeeded, the app happily reported
 * success while nothing appeared. That is the whole "Open in PowerShell does nothing" bug.
 *
 * cmd's `start` is the way to ask for a console: it launches its target with
 * CREATE_NEW_CONSOLE and returns immediately, so the shell still outlives CmdCLD. Two
 * details it is easy to get wrong:
 *
 *   - the empty '' argument is the window title. `start` treats the first quoted token as
 *     one, so without it a quoted shell path would be eaten as the title;
 *   - `start` reads a leading /-token as its own switch, so the executable path must use
 *     backslashes. Everything here is built from ${SystemRoot}-style paths that already
 *     do, and the conversion below keeps that true for anything that does not.
 *
 * The folder never joins the command line — it stays the cwd of the cmd.exe process and
 * the new console inherits it — so a path with a space or an ampersand is still not
 * something a parser ever sees.
 */
export function buildLaunchPlan(
  chosen: TerminalCandidate,
  folderPath: string,
  platform: NodeJS.Platform = process.platform,
): LaunchPlan {
  if (chosen.passesFolderAsArg) {
    return { cmd: chosen.cmd, args: [...chosen.args, folderPath], cwd: undefined }
  }

  if (platform === 'win32' && chosen.needsConsole) {
    // Absolute where ${SystemRoot} resolves, a bare name otherwise — which PATH finds on
    // any real Windows machine. Falling back rather than reading the host environment as
    // a precondition is what lets the win32 branch be exercised from a Linux or macOS
    // test runner, where SystemRoot does not exist.
    const comspec = expandEnv('${SystemRoot}\\System32\\cmd.exe') ?? 'cmd.exe'
    const exe = chosen.cmd.replace(/\//g, '\\')
    return { cmd: comspec, args: ['/c', 'start', '', exe, ...chosen.args], cwd: folderPath }
  }

  return { cmd: chosen.cmd, args: chosen.args, cwd: folderPath }
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
  const plan = buildLaunchPlan(chosen, folderPath)

  try {
    const child = spawn(plan.cmd, plan.args, {
      // Inheriting cwd is what keeps the path out of any shell's parser.
      cwd: plan.cwd,
      detached: true,
      stdio: 'ignore',
      // The whole point is a visible window, so this must not be hidden.
      windowsHide: false,
    })
    // spawn reports a missing executable asynchronously, and an 'error' event with no
    // listener takes the main process down with it. Every candidate was existsSync'd
    // during detection, so this is a guard rather than an expected path — but it must
    // not be the thing that crashes the app.
    child.on('error', () => {})
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

