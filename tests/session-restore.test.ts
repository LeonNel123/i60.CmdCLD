import { describe, expect, it } from 'vitest'
import { resolveRestoredSession, minimizedIdsFromRestore } from '../src/shared/session-restore'

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
