import { describe, expect, it } from 'vitest'
import { buildPtyEnv } from '../src/main/pty-env'

// Both of these show up as odd CLI behaviour rather than as errors, so nothing fails
// loudly when they regress.
describe('buildPtyEnv', () => {
  // Agent CLIs read COLORTERM to decide whether they may emit 24-bit colour. Without it
  // the same session renders with less styling in CmdCLD than in a terminal that
  // advertises truecolor — basic colours survive, richer ones silently do not.
  it('advertises truecolor even when the launcher did not', () => {
    expect(buildPtyEnv({ PATH: '/usr/bin' }).COLORTERM).toBe('truecolor')
  })

  it('overrides a weaker COLORTERM from the launcher', () => {
    expect(buildPtyEnv({ COLORTERM: '256' }).COLORTERM).toBe('truecolor')
  })

  // Launch CmdCLD from a VS Code terminal and, unfixed, every session claims to be
  // running inside VS Code — affecting IDE auto-connect, shell integration and askpass.
  it('does not let the launching terminal identify the session', () => {
    const env = buildPtyEnv({
      TERM_PROGRAM: 'vscode',
      TERM_PROGRAM_VERSION: '1.99.0',
      VSCODE_INJECTION: '1',
      VSCODE_GIT_ASKPASS_MAIN: 'C:/vscode/askpass.js',
      PATH: '/usr/bin',
    })
    expect(env.TERM_PROGRAM).toBe('CmdCLD')
    expect(env.VSCODE_INJECTION).toBeUndefined()
    expect(env.VSCODE_GIT_ASKPASS_MAIN).toBeUndefined()
    expect(Object.keys(env).some((k) => k.startsWith('VSCODE_'))).toBe(false)
  })

  it('reports the app version as the host version', () => {
    expect(buildPtyEnv({}, { appVersion: '1.6.30' }).TERM_PROGRAM_VERSION).toBe('1.6.30')
  })

  it('omits the host version when none is given, rather than inheriting a stale one', () => {
    expect(buildPtyEnv({ TERM_PROGRAM_VERSION: '1.99.0' }).TERM_PROGRAM_VERSION).toBeUndefined()
  })

  // Everything the shell actually needs must survive untouched.
  it('passes ordinary variables through', () => {
    const env = buildPtyEnv({ PATH: '/usr/bin', HOME: '/home/me', ANTHROPIC_API_KEY: 'sk-x' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/me')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-x')
  })

  it('drops undefined values rather than passing the string "undefined"', () => {
    const env = buildPtyEnv({ SET: 'yes', UNSET: undefined })
    expect(env.SET).toBe('yes')
    expect('UNSET' in env).toBe(false)
  })
})
