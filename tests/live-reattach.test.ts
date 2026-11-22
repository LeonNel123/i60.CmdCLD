import { describe, expect, it } from 'vitest'
import { terminalsFromLiveSessions } from '../src/shared/live-reattach'

const colors = ['#111', '#222', '#333']
const pickColor = (used: string[]): string => colors.find((c) => !used.includes(c)) ?? '#000'

// After a renderer reload the PTYs are still alive in main under their original ids.
// Rebuilding tiles with those same ids is what makes TerminalPanel take its remount
// path (replay scrollback) instead of creating a second PTY and launching a second agent.
describe('terminalsFromLiveSessions', () => {
  it('keeps the live session id, path and name', () => {
    const [t] = terminalsFromLiveSessions(
      [{ id: 'abc', path: 'D:\proj', name: 'proj', color: '#abc', agentCli: 'claude', launchArgs: '--continue' }],
      pickColor,
    )
    expect(t.id).toBe('abc')
    expect(t.path).toBe('D:\proj')
    expect(t.name).toBe('proj')
    expect(t.color).toBe('#abc')
  })

  it('files the launch args under the session agent and leaves the others empty', () => {
    const [t] = terminalsFromLiveSessions(
      [{ id: 'a', path: 'D:\p', name: 'p', color: '', agentCli: 'codex', launchArgs: 'resume --last' }],
      pickColor,
    )
    expect(t.agentCli).toBe('codex')
    expect(t.codexArgs).toBe('resume --last')
    expect(t.claudeArgs).toBe('')
    expect(t.grokArgs).toBe('')
    expect(t.opencodeArgs).toBe('')
  })

  it('assigns a colour to sessions main stored without one, avoiding duplicates', () => {
    const out = terminalsFromLiveSessions(
      [
        { id: 'a', path: 'D:\a', name: 'a', color: '' },
        { id: 'b', path: 'D:\b', name: 'b', color: '#222' },
        { id: 'c', path: 'D:\c', name: 'c', color: '' },
      ],
      pickColor,
    )
    expect(out.map((t) => t.color)).toEqual(['#111', '#222', '#333'])
  })

  // Main used to have no idea a session was a plain shell, so after a window
  // reload (or on the /desktop page) a shell came back as an agent tile.
  it('brings a plain shell back as a plain shell, named like one', () => {
    const [t] = terminalsFromLiveSessions(
      [{ id: 'a', path: 'D:\p', name: 'p', color: '#1', agentCli: 'claude', launchArgs: '', isPlainShell: true }],
      pickColor,
    )
    expect(t.isPlainShell).toBe(true)
    expect(t.name).toBe('p (shell)')
  })

  it('leaves agent sessions unmarked', () => {
    const [t] = terminalsFromLiveSessions(
      [{ id: 'a', path: 'D:\p', name: 'p', color: '#1', agentCli: 'claude', launchArgs: '' }],
      pickColor,
    )
    expect(t.isPlainShell).toBeUndefined()
    expect(t.name).toBe('p')
  })

  it('normalises an unknown agent to the default CLI', () => {
    const [t] = terminalsFromLiveSessions(
      [{ id: 'a', path: 'D:\p', name: 'p', color: '#1', agentCli: 'bogus' as never, launchArgs: '' }],
      pickColor,
    )
    expect(t.agentCli).toBe('claude')
  })

  it('returns nothing for no live sessions', () => {
    expect(terminalsFromLiveSessions([], pickColor)).toEqual([])
  })
})
