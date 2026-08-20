import { describe, expect, it } from 'vitest'
import { buildLaunchPlan, detectTerminals, openExternalTerminal } from '../src/main/external-terminal'

// Opening a shell at a project folder is only useful if it survives the app and if the
// folder path never has to get through a shell parser — that is where this kind of
// feature normally breaks on paths with spaces or ampersands.
describe('detectTerminals', () => {
  const found = detectTerminals()

  it('finds at least one terminal on this machine', () => {
    expect(found.length).toBeGreaterThan(0)
  })

  it('gives every candidate an id, a name and a command', () => {
    for (const t of found) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.cmd).toBeTruthy()
      expect(Array.isArray(t.args)).toBe(true)
    }
  })

  it('uses unique ids so the menu can key on them', () => {
    expect(new Set(found.map((t) => t.id)).size).toBe(found.length)
  })

  // Anything not passing the folder as an argument gets it via cwd instead, which is
  // what keeps quoting out of the picture entirely.
  it('never embeds the folder in a command string', () => {
    for (const t of found) {
      expect(t.args.join(' ')).not.toMatch(/cd |Set-Location|\$\{/)
    }
  })

  it('marks the Windows console shells as needing a console of their own', () => {
    if (process.platform !== 'win32') return
    for (const t of found) {
      const isConsoleShell = ['pwsh', 'powershell', 'cmd'].includes(t.id)
      expect(t.needsConsole ?? false).toBe(isConsoleShell)
    }
  })
})

// A console application spawned from a GUI process with `detached: true` gets
// DETACHED_PROCESS — no console at all, rather than a new one. powershell.exe then reads
// EOF from its NUL stdin and exits within milliseconds while spawn() reports success,
// which is exactly how "Open in PowerShell" managed to do nothing, silently. Console
// candidates go through cmd's `start` instead, which does create a console for them.
describe('buildLaunchPlan', () => {
  const winShell = {
    id: 'powershell',
    name: 'Windows PowerShell',
    cmd: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    args: ['-NoLogo', '-NoExit'],
    needsConsole: true,
  }
  const winGui = {
    id: 'wt',
    name: 'Windows Terminal',
    cmd: 'C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
    args: [],
  }
  const macApp = { id: 'terminal', name: 'Terminal', cmd: 'open', args: ['-a', 'Terminal'], passesFolderAsArg: true }

  it('routes a console shell through cmd start so it gets a console', () => {
    const plan = buildLaunchPlan(winShell, 'D:\\code\\my project', 'win32')
    expect(plan.cmd.toLowerCase()).toMatch(/cmd\.exe$/)
    // The empty title argument matters: `start` reads the first quoted token as a
    // window title, and without it the shell path would be swallowed as one.
    expect(plan.args.slice(0, 3)).toEqual(['/c', 'start', ''])
    expect(plan.args.slice(3)).toEqual([winShell.cmd, '-NoLogo', '-NoExit'])
  })

  // `start` reads a leading /-token as one of its own switches, so a path handed to it
  // has to use backslashes. A forward-slash path is what made the first attempt at this
  // fix look like the whole approach was wrong.
  it('never hands start a forward-slash path', () => {
    const plan = buildLaunchPlan({ ...winShell, cmd: 'C:/Windows/System32/cmd.exe' }, 'D:\\code', 'win32')
    expect(plan.args.some((a) => a.includes('/Windows'))).toBe(false)
  })

  // The folder stays off the command line: `start` would parse it, and a path with a
  // space or an ampersand is precisely where that goes wrong.
  it('passes the folder as cwd, never as an argument', () => {
    const plan = buildLaunchPlan(winShell, 'D:\\code\\a & b', 'win32')
    expect(plan.cwd).toBe('D:\\code\\a & b')
    expect(plan.args.join(' ')).not.toContain('a & b')
  })

  it('spawns a GUI terminal directly — it has no console problem to solve', () => {
    const plan = buildLaunchPlan(winGui, 'D:\\code', 'win32')
    expect(plan.cmd).toBe(winGui.cmd)
    expect(plan.args).toEqual([])
    expect(plan.cwd).toBe('D:\\code')
  })

  it('leaves the mac open -a form alone: folder as argument, no cwd', () => {
    const plan = buildLaunchPlan(macApp, '/Users/x/code', 'darwin')
    expect(plan.cmd).toBe('open')
    expect(plan.args).toEqual(['-a', 'Terminal', '/Users/x/code'])
    expect(plan.cwd).toBeUndefined()
  })

  it('does not reach for cmd on a platform that has none', () => {
    const linux = { id: 'konsole', name: 'Konsole', cmd: '/usr/bin/konsole', args: [] }
    const plan = buildLaunchPlan(linux, '/home/x/code', 'linux')
    expect(plan.cmd).toBe('/usr/bin/konsole')
    expect(plan.cwd).toBe('/home/x/code')
  })
})

describe('openExternalTerminal', () => {
  it('refuses a path that does not exist', () => {
    const r = openExternalTerminal('/definitely/not/a/real/folder/xyzzy')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no longer exists/i)
  })

  it('refuses a file rather than a folder', () => {
    const r = openExternalTerminal(new URL(import.meta.url).pathname.replace(/^\//, ''))
    expect(r.ok).toBe(false)
  })
})
