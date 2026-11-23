import { describe, expect, it } from 'vitest'
import { resolveRestoredSession, minimizedIdsFromRestore } from '../src/shared/session-restore'
import { shouldSaveSession } from '../src/shared/session-restore'

const saved = {
  path: 'D:/proj',
  agentCli: 'codex' as const,
  claudeArgs: '--dangerously-skip-permissions',
  codexArgs: '--sandbox workspace-write',
  grokArgs: '--effort high',
  opencodeArgs: '-m openrouter/z-ai/glm-5.3-flash',
  isPlainShell: false,
}

describe('restoring a saved session', () => {
  // Current agent settings. The saved session's own args are a snapshot from when it was
  // saved and deliberately play no part: restoring with them is how a settings change
  // (adding --continue, say) failed to reach every project open at the time.
  const argsSettings = {
    claudeArgs: '--dangerously-skip-permissions',
    codexArgs: '--sandbox workspace-write',
    grokArgs: '--effort high',
    opencodeArgs: '-m openrouter/z-ai/glm-5.3-flash',
  }

  it('launches with the current settings, not the saved snapshot', () => {
    const stale = { ...saved, agentCli: 'claude' as const, claudeArgs: '--old-flag' }
    const r = resolveRestoredSession(stale, false, { argsSettings: { ...argsSettings, claudeArgs: '--continue' } })
    expect(r.agentCli).toBe('claude')
    expect(r.argsByAgent.claude).toBe('--continue')
  })

  it('keeps args the user customised for the folder', () => {
    const r = resolveRestoredSession(saved, false, {
      argsSettings,
      remembered: { agentCli: 'codex', customArgs: '--sandbox read-only' },
    })
    expect(r.argsByAgent.codex).toBe('--sandbox read-only')
    expect(r.remember).toEqual({ agentCli: 'codex', customArgs: '--sandbox read-only' })
  })

  it('drops customised args that belong to a different CLI', () => {
    const r = resolveRestoredSession(saved, false, {
      argsSettings,
      remembered: { agentCli: 'claude', customArgs: '--model opus' },
    })
    expect(r.argsByAgent.codex).toBe('--sandbox workspace-write')
    expect(r.remember).toEqual({ agentCli: 'codex' })
  })

  // Resume flags differ per CLI: Claude and friends take --continue, Codex takes a
  // `resume` subcommand which must lead. Applying one CLI's form to another silently
  // starts a fresh session, or makes Codex treat "resume" as a project path.
  it('applies each CLI its own resume form', () => {
    const r = resolveRestoredSession(saved, true, { argsSettings })
    expect(r.argsByAgent.claude).toBe('--dangerously-skip-permissions --continue')
    expect(r.argsByAgent.codex).toBe('resume --last --sandbox workspace-write')
    expect(r.argsByAgent.grok).toBe('--effort high --continue')
    expect(r.argsByAgent.opencode).toBe('-m openrouter/z-ai/glm-5.3-flash --continue')
  })

  // The resume flag belongs to this restore, not to the project. Remembering it would
  // make every later open resume, and --continue would compound on each save/restore.
  // A folder opted out of the global flags (customArgs: '') must not get them
  // back from a restore, and must stay opted out afterwards.
  it('restores a folder that was launched with no args without the global ones', () => {
    const bare = { ...saved, agentCli: 'claude' as const }
    const remembered = { agentCli: 'claude' as const, customArgs: '' }
    const r = resolveRestoredSession(bare, false, { argsSettings, remembered })
    expect(r.argsByAgent.claude).toBe('')
    expect(r.remember).toEqual({ agentCli: 'claude', customArgs: '' })
    const resumed = resolveRestoredSession(bare, true, { argsSettings, remembered })
    expect(resumed.argsByAgent.claude).not.toContain('--dangerously-skip-permissions')
    expect(resumed.remember).toEqual({ agentCli: 'claude', customArgs: '' })
  })

  it('never lets resume flags leak into what the folder remembers', () => {
    const resumed = resolveRestoredSession(saved, true, { argsSettings })
    expect(resumed.remember).toEqual({ agentCli: 'codex' })
  })
})

describe('carrying minimized state across a restore', () => {
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const projects = [
    { path: 'p1', minimized: true },
    { path: 'p2' },
    { path: 'p3', minimized: true },
  ]

  it('maps minimized flags onto the matching new terminal ids', () => {
    expect(minimizedIdsFromRestore(entries, projects)).toEqual(['a', 'c'])
  })

  it('returns nothing when none were minimized', () => {
    expect(minimizedIdsFromRestore(entries, [{ path: 'p1' }, { path: 'p2' }, { path: 'p3' }])).toEqual([])
  })

  // The alignment is positional and invisible. If the entry list is ever filtered rather
  // than mapped, minimized state would silently attach to the wrong tiles; this makes it
  // an error at the call site instead.
  it('throws rather than misattributing when the two lists disagree', () => {
    expect(() => minimizedIdsFromRestore([{ id: 'a' }], projects)).toThrow(/1:1/)
    expect(() => minimizedIdsFromRestore(entries, [{ path: 'p1' }])).toThrow(/1:1/)
  })
})

// One file holds "the last session". Every window wrote to it, a second after
// it opened and again on close: a window that had not reopened anything yet
// wrote an empty list over the session it was offering to reopen, and a second
// window (which always starts empty) did the same to the first window's.
describe('shouldSaveSession', () => {
  const base = { restoreEnabled: true, secondaryWindow: false, terminalCount: 2, hadTerminals: true }

  it('saves the open terminals of the primary window', () => {
    expect(shouldSaveSession(base)).toBe(true)
  })

  it('does not save when restore is off', () => {
    expect(shouldSaveSession({ ...base, restoreEnabled: false })).toBe(false)
  })

  it('never saves from a second window', () => {
    expect(shouldSaveSession({ ...base, secondaryWindow: true })).toBe(false)
    expect(shouldSaveSession({ ...base, secondaryWindow: true, terminalCount: 0 })).toBe(false)
  })

  it('does not save an empty list from a window that has not opened anything yet', () => {
    expect(shouldSaveSession({ ...base, terminalCount: 0, hadTerminals: false })).toBe(false)
  })

  it('saves an empty list once the person has closed everything they had open', () => {
    expect(shouldSaveSession({ ...base, terminalCount: 0, hadTerminals: true })).toBe(true)
  })
})
