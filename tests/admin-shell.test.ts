import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { encodePsCommand, buildAdminShellScript, openAdminShell, stripClixml, detectElevationBridge } from '../src/main/admin-shell'

const decodePsCommand = (b64: string): string => Buffer.from(b64, 'base64').toString('utf16le')

const extractSetLocationB64 = (script: string): string | undefined =>
  script.match(/-NoExit -EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1]

describe('encodePsCommand', () => {
  it('round-trips through UTF-16LE base64', () => {
    const cmd = `Set-Location -LiteralPath 'C:\\Users\\dewal'`
    expect(decodePsCommand(encodePsCommand(cmd))).toBe(cmd)
  })

  it('survives spaces, quotes and non-ASCII', () => {
    const cmd = `Set-Location -LiteralPath 'C:\\Ünïcode päth with "quotes" and spaces'`
    expect(decodePsCommand(encodePsCommand(cmd))).toBe(cmd)
  })
})

describe('buildAdminShellScript', () => {
  it('elevates the given shell via the ShellExecute runas verb', () => {
    const script = buildAdminShellScript('pwsh.exe', 'C:\\Users\\dewal')
    expect(script).toContain(`$psi.FileName = 'pwsh.exe'`)
    expect(script).toContain(`$psi.Verb = 'runas'`)
    expect(script).toContain(`$psi.UseShellExecute = $true`)
  })

  it('uses .NET Process.Start, not the Start-Process cmdlet (which discards the UAC-decline Win32Exception)', () => {
    const script = buildAdminShellScript('pwsh.exe', 'C:\\Users\\dewal')
    expect(script).toContain('[System.Diagnostics.Process]::Start($psi)')
    expect(script).not.toContain('Start-Process')
  })

  it('cds the elevated shell to the start dir via -EncodedCommand', () => {
    const script = buildAdminShellScript('pwsh.exe', 'C:\\Users\\dewal')
    const b64 = extractSetLocationB64(script)
    expect(b64).toBeTruthy()
    expect(decodePsCommand(b64!)).toBe(`Set-Location -LiteralPath 'C:\\Users\\dewal'`)
  })

  it('escapes single quotes in the start dir (PowerShell doubling)', () => {
    const script = buildAdminShellScript('powershell.exe', `C:\\Users\\o'brien`)
    const b64 = extractSetLocationB64(script)
    expect(decodePsCommand(b64!)).toBe(`Set-Location -LiteralPath 'C:\\Users\\o''brien'`)
  })

  it('maps UAC decline (Win32 1223) to exit 2, other failures to exit 1', () => {
    const script = buildAdminShellScript('pwsh.exe', 'C:\\')
    expect(script).toContain('NativeErrorCode -eq 1223')
    expect(script).toContain('exit 2')
    expect(script).toContain('exit 1')
    // walks InnerException instead of string-matching a localized message
    expect(script).toContain('InnerException')
  })

  it('writes the innermost failure message to stdout (stderr gets CLIXML-wrapped)', () => {
    const script = buildAdminShellScript('pwsh.exe', 'C:\\')
    expect(script).toContain('while ($m.InnerException) { $m = $m.InnerException }')
    expect(script).toContain('[Console]::Out.WriteLine($m.Message)')
    expect(script).not.toContain('[Console]::Error.WriteLine')
  })
})

describe('stripClixml', () => {
  it('drops the CLIXML header and XML records, keeps the plain message', () => {
    const raw = '#< CLIXML\r\nThis command cannot be run due to the error: nope.\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0">...</Obj></Objs>'
    expect(stripClixml(raw)).toBe('This command cannot be run due to the error: nope.')
  })

  it('returns empty for pure CLIXML noise', () => {
    expect(stripClixml('#< CLIXML\r\n<Objs Version="1.1.0.1"></Objs>\r\n')).toBe('')
  })
})

// detectElevationBridge short-circuits to null off-Windows, so the injected
// exec paths are only reachable on win32.
describe.runIf(process.platform === 'win32')('detectElevationBridge', () => {
  const gsudoPath = 'C:\\Program Files\\gsudo\\Current\\gsudo.exe'
  const noFile = () => false

  it('prefers gsudo when on PATH', () => {
    const exec = (file: string) => {
      if (file === 'where.exe') return `${gsudoPath}\r\n`
      throw new Error('unexpected call')
    }
    expect(detectElevationBridge(exec, noFile)).toEqual({ kind: 'gsudo', exe: gsudoPath })
  })

  it('finds gsudo at its default install path when PATH is stale', () => {
    const exec = () => { throw new Error('not found') }
    const fileExists = (p: string) => p === gsudoPath
    expect(detectElevationBridge(exec, fileExists)).toEqual({ kind: 'gsudo', exe: gsudoPath })
  })

  it('falls back to built-in sudo only when configured inline (0x3)', () => {
    const exec = (file: string) => {
      if (file === 'where.exe') throw new Error('not found')
      return 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo\r\n    Enabled    REG_DWORD    0x3\r\n'
    }
    expect(detectElevationBridge(exec, noFile)).toEqual({ kind: 'sudo-inline', exe: 'sudo.exe' })
  })

  it('rejects built-in sudo in disabled, new-window, and input-disabled modes', () => {
    for (const value of ['0x0', '0x1', '0x2', '0x30']) {
      const exec = (file: string) => {
        if (file === 'where.exe') throw new Error('not found')
        return `    Enabled    REG_DWORD    ${value}\r\n`
      }
      expect(detectElevationBridge(exec, noFile)).toBeNull()
    }
  })

  it('returns null when neither bridge exists', () => {
    const exec = () => { throw new Error('not found') }
    expect(detectElevationBridge(exec, noFile)).toBeNull()
  })
})

describe('openAdminShell', () => {
  function fakeSpawn(exitCode: number | null, opts: { stdout?: string; stderr?: string; spawnError?: Error } = {}) {
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const spawnFn = ((cmd: string, args: string[], spawnOpts: unknown) => {
      fakeSpawn.lastCall = { cmd, args, opts: spawnOpts }
      queueMicrotask(() => {
        if (opts.spawnError) {
          child.emit('error', opts.spawnError)
          return
        }
        if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
        if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
        child.emit('close', exitCode)
      })
      return child
    }) as any
    return spawnFn
  }
  fakeSpawn.lastCall = null as null | { cmd: string; args: string[]; opts: unknown }

  it('resolves ok on exit 0 and hides the wrapper window', async () => {
    const spawnFn = fakeSpawn(0)
    const res = await openAdminShell('pwsh.exe', 'C:\\Users\\dewal', spawnFn)
    expect(res).toEqual({ ok: true })
    expect(fakeSpawn.lastCall!.cmd).toBe('powershell.exe')
    expect(fakeSpawn.lastCall!.args).toContain('-NonInteractive')
    expect((fakeSpawn.lastCall!.opts as { windowsHide: boolean }).windowsHide).toBe(true)
  })

  it('spawns the encoded wrapper script built from the given shell and dir', async () => {
    const spawnFn = fakeSpawn(0)
    await openAdminShell('pwsh.exe', 'C:\\Users\\dewal', spawnFn)
    const args = fakeSpawn.lastCall!.args
    const encoded = args[args.indexOf('-EncodedCommand') + 1]
    expect(decodePsCommand(encoded)).toBe(buildAdminShellScript('pwsh.exe', 'C:\\Users\\dewal'))
  })

  it('treats exit 2 as a silent UAC decline', async () => {
    const res = await openAdminShell('pwsh.exe', 'C:\\', fakeSpawn(2))
    expect(res).toEqual({ ok: true, cancelled: true })
  })

  it('prefers the wrapper stdout message on failure', async () => {
    const res = await openAdminShell('pwsh.exe', 'C:\\', fakeSpawn(1, {
      stdout: 'The directory name is invalid.\r\n',
      stderr: '#< CLIXML\r\n<Objs Version="1.1.0.1"></Objs>',
    }))
    expect(res.ok).toBe(false)
    expect(res.error).toBe('The directory name is invalid.')
  })

  it('falls back to CLIXML-stripped stderr when stdout is empty', async () => {
    const res = await openAdminShell('pwsh.exe', 'C:\\', fakeSpawn(1, {
      stderr: '#< CLIXML\r\nThe value of -EncodedCommand is not properly encoded.\r\n<Objs Version="1.1.0.1"></Objs>',
    }))
    expect(res.ok).toBe(false)
    expect(res.error).toBe('The value of -EncodedCommand is not properly encoded.')
  })

  it('falls back to the exit code when both streams are noise-free empty', async () => {
    const res = await openAdminShell('pwsh.exe', 'C:\\', fakeSpawn(3))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('code 3')
  })

  it('resolves ok:false when the wrapper cannot spawn', async () => {
    const res = await openAdminShell('pwsh.exe', 'C:\\', fakeSpawn(null, { spawnError: new Error('spawn ENOENT') }))
    expect(res).toEqual({ ok: false, error: 'spawn ENOENT' })
  })
})
