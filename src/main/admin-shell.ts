import { spawn, execFileSync } from 'child_process'
import { existsSync } from 'fs'

// Elevated ("Run as administrator") shells.
//
// An unelevated process cannot create an elevated child on Windows, so an
// admin PTY inside the grid is only possible through an elevation bridge —
// gsudo, or Windows' built-in sudo when configured "inline" — which relays
// the elevated shell back into the calling console. When a bridge exists,
// the pty tile spawns `<bridge> <shell>` (detectElevationBridge below).
// Without one, openAdminShell falls back to a separate elevated OS window
// via UAC — the same model Windows Terminal uses for admin tabs.

export type ElevationBridge = { kind: 'gsudo'; exe: string } | { kind: 'sudo-inline'; exe: string }

type ExecFn = (file: string, args: string[]) => string

const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })

// Default machine-wide gsudo install location. Checked in addition to PATH:
// a process started before gsudo was installed still has the old PATH, so
// `where.exe` misses it until the app restarts — the file check doesn't.
const GSUDO_DEFAULT_EXE = 'C:\\Program Files\\gsudo\\Current\\gsudo.exe'

export function detectElevationBridge(exec: ExecFn = defaultExec, fileExists: (p: string) => boolean = existsSync): ElevationBridge | null {
  if (process.platform !== 'win32') return null
  try {
    // Query for gsudo.exe specifically and keep only .exe hits: gsudo ships
    // an extensionless `gsudo` shell script next to the exe, and a bare
    // `where gsudo` lists the script first — CreateProcess on it fails with
    // ERROR_BAD_EXE_FORMAT (193).
    const hit = exec('where.exe', ['gsudo.exe'])
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /\.exe$/i.test(l))
    if (hit) return { kind: 'gsudo', exe: hit }
  } catch {}
  try {
    if (fileExists(GSUDO_DEFAULT_EXE)) return { kind: 'gsudo', exe: GSUDO_DEFAULT_EXE }
  } catch {}
  try {
    // Built-in sudo (Win11 24H2+): HKLM\...\Sudo\Enabled DWORD — 0 disabled,
    // 1 new window, 2 input disabled, 3 inline. Only inline keeps the
    // elevated shell in the current console, so only 3 counts.
    const out = exec('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo', '/v', 'Enabled'])
    if (/\bEnabled\s+REG_DWORD\s+0x3\b/i.test(out)) return { kind: 'sudo-inline', exe: 'sudo.exe' }
  } catch {}
  return null
}

export interface AdminShellResult {
  ok: boolean
  cancelled?: boolean // user said No to the UAC prompt
  error?: string
}

// PowerShell single-quoted string literal: double any embedded single quotes.
const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

// Encode a command for PowerShell's -EncodedCommand (UTF-16LE → base64).
// The shell receives the command as one opaque token, which sidesteps every
// layer of Win32/PowerShell argument re-quoting (spaces, quotes, newlines).
export function encodePsCommand(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64')
}

// Wrapper exit codes: 0 = launched, 2 = UAC declined, anything else = failure.
const EXIT_DECLINED = 2

export function buildAdminShellScript(shellExe: string, startDir: string): string {
  // The runas verb ignores the working directory (elevated shells start in
  // System32), so the elevated shell has to cd itself.
  const setLocation = encodePsCommand(`Set-Location -LiteralPath ${psQuote(startDir)}`)
  // .NET Process.Start instead of the Start-Process cmdlet: the cmdlet
  // rethrows ShellExecute failures as a bare InvalidOperationException,
  // discarding the Win32Exception whose NativeErrorCode distinguishes a UAC
  // decline (ERROR_CANCELLED, 1223) — the .NET path keeps it in the
  // InnerException chain, which we walk instead of string-matching a
  // localized message. Failure messages go to STDOUT: powershell.exe wraps
  // redirected stderr in CLIXML noise, raw [Console] writes stay clean.
  return (
    `$ErrorActionPreference='Stop'; ` +
    `try { ` +
    `$psi = New-Object System.Diagnostics.ProcessStartInfo; ` +
    `$psi.FileName = ${psQuote(shellExe)}; ` +
    `$psi.Verb = 'runas'; ` +
    `$psi.UseShellExecute = $true; ` +
    `$psi.Arguments = '-NoExit -EncodedCommand ${setLocation}'; ` +
    `[System.Diagnostics.Process]::Start($psi) | Out-Null; exit 0 ` +
    `} catch { ` +
    `$e = $_.Exception; while ($e) { if (($e -is [System.ComponentModel.Win32Exception]) -and ($e.NativeErrorCode -eq 1223)) { exit ${EXIT_DECLINED} }; $e = $e.InnerException }; ` +
    `$m = $_.Exception; while ($m.InnerException) { $m = $m.InnerException }; ` +
    `[Console]::Out.WriteLine($m.Message); exit 1 ` +
    `}`
  )
}

// powershell.exe announces CLIXML serialization on redirected stderr
// ('#< CLIXML' header plus <Objs …> records around the real text), so keep
// only plain-text lines when falling back to stderr for an error message.
export function stripClixml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== '#< CLIXML' && !l.startsWith('<'))
    .join(' ')
    .trim()
}

type SpawnFn = typeof spawn

export function openAdminShell(
  shellExe: string,
  startDir: string,
  spawnFn: SpawnFn = spawn,
): Promise<AdminShellResult> {
  return new Promise((resolve) => {
    const script = buildAdminShellScript(shellExe, startDir)
    // Wrapper host is always windows powershell.exe — present on every
    // Windows install even when the elevated target is pwsh.
    const child = spawnFn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePsCommand(script)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', (err: Error) => resolve({ ok: false, error: err.message }))
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ ok: true })
      else if (code === EXIT_DECLINED) resolve({ ok: true, cancelled: true })
      else {
        // The wrapper prints its failure message on stdout; stderr is only a
        // fallback for host-level failures (e.g. a mangled -EncodedCommand).
        const message = stdout.trim() || stripClixml(stderr)
        resolve({ ok: false, error: (message || `elevation wrapper exited with code ${code}`).slice(0, 300) })
      }
    })
  })
}
