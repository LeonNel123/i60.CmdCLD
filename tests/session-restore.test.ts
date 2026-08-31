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
  it('returns the saved args untouched when not resuming', () => {
    const r = resolveRestoredSession(saved, false)
    expect(r.agentCli).toBe('codex')
    expect(r.argsByAgent.codex).toBe('--sandbox workspace-write')
    expect(r.argsByAgent.claude).toBe('--dangerously-skip-permissions')
    expect(Object.values(r.argsByAgent).join(' ')).not.toContain('--continue')
  })

  // Resume flags differ per CLI: Claude and friends take --continue, Codex takes a
  // `resume` subcommand which must lead. Applying one CLI's form to another silently
  // starts a fresh session, or makes Codex treat "resume" as a project path.
  it('applies each CLI its own resume form', () => {
    const r = resolveRestoredSession(saved, true)
    expect(r.argsByAgent.claude).toBe('--dangerously-skip-permissions --continue')
    expect(r.argsByAgent.codex).toBe('resume --last --sandbox workspace-write')
    expect(r.argsByAgent.grok).toBe('--effort high --continue')
    expect(r.argsByAgent.opencode).toBe('-m openrouter/z-ai/glm-5.3-flash --continue')
  })

  // The resume flag belongs to this restore, not to the project. Remembering it would
  // make every later open resume, and --continue would compound on each save/restore.
  it('never lets resume flags leak into what the folder remembers', () => {
    const resumed = resolveRestoredSession(saved, true)
    expect(resumed.rememberArgs).toBe('--sandbox workspace-write')
    expect(resumed.rememberArgs).not.toContain('resume')

    const plain = resolveRestoredSession(saved, false)
    expect(plain.rememberArgs).toBe('--sandbox workspace-write')
  })

  it('remembers the args of the saved CLI, not of some other one', () => {
    const r = resolveRestoredSession({ ...saved, agentCli: 'opencode' }, true)
    expect(r.agentCli).toBe('opencode')
    expect(r.rememberArgs).toBe('-m openrouter/z-ai/glm-5.3-flash')
  })

  it('defaults a missing or unknown CLI to claude', () => {
    expect(resolveRestoredSession({ path: 'D:/x' }, false).agentCli).toBe('claude')
    expect(resolveRestoredSession({ path: 'D:/x', agentCli: 'gemini' as never }, false).agentCli).toBe('claude')
  })

  it('tolerates a saved project with no args at all', () => {
    const r = resolveRestoredSession({ path: 'D:/x', agentCli: 'claude' }, true)
    expect(r.argsByAgent.claude).toBe('--continue')
    expect(r.rememberArgs).toBe('')
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
