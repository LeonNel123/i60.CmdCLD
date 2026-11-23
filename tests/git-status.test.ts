import { describe, expect, it } from 'vitest'
import { parsePorcelainStatus, probeGitStatus } from '../src/main/git-status'

describe('parsePorcelainStatus', () => {
  it('reads a clean branch that tracks a remote', () => {
    expect(parsePorcelainStatus('## main...origin/main\n')).toEqual({ dirty: false, ahead: 0, hasUpstream: true })
  })

  it('reads unpushed commits and changed files', () => {
    expect(parsePorcelainStatus('## main...origin/main [ahead 3, behind 1]\n M src/a.ts\n?? new.txt\n'))
      .toEqual({ dirty: true, ahead: 3, hasUpstream: true })
  })

  it('knows a branch with no upstream from one with nothing to push', () => {
    expect(parsePorcelainStatus('## feature/x\n')).toEqual({ dirty: false, ahead: 0, hasUpstream: false })
    expect(parsePorcelainStatus('## HEAD (no branch)\n')).toEqual({ dirty: false, ahead: 0, hasUpstream: false })
  })

  it('does not take a dotted branch name for an upstream', () => {
    expect(parsePorcelainStatus('## release/1.2.x\n').hasUpstream).toBe(false)
  })
})

// The close dialog warns about work that exists only on this machine. Two
// ways it stayed silent when it should not have:
describe('probeGitStatus', () => {
  type Run = (cwd: string, args: string[]) => Promise<string>
  const runner = (answers: Record<string, string | Error>): Run => async (_cwd, args) => {
    const key = Object.keys(answers).find((k) => args.join(' ').startsWith(k))
    if (!key) throw new Error('unexpected git ' + args.join(' '))
    const a = answers[key]
    if (a instanceof Error) throw a
    return a
  }

  // 1. git status timing out (a large repo, a cold disk) was reported as clean.
  it('says it does not know when git status fails, not that the tree is clean', async () => {
    const s = await probeGitStatus('/repo', runner({ 'rev-parse': 'main\n', 'status': new Error('timed out') }))
    expect(s).toEqual({ isRepo: true, branch: 'main', dirty: false, ahead: 0, unknown: true })
  })

  // 2. A branch that was never pushed has no upstream, so "ahead" was 0 with
  // every commit on it unpushed.
  it('counts the commits no remote has when the branch has no upstream', async () => {
    const s = await probeGitStatus('/repo', runner({
      'rev-parse': 'feature/x\n', 'status': '## feature/x\n', 'remote': 'origin\n', 'rev-list': '4\n',
    }))
    expect(s).toEqual({ isRepo: true, branch: 'feature/x', dirty: false, ahead: 4 })
  })

  it('reports nothing to push for a repository with no remote at all', async () => {
    const s = await probeGitStatus('/repo', runner({ 'rev-parse': 'main\n', 'status': '## main\n', 'remote': '\n' }))
    expect(s.ahead).toBe(0)
  })

  it('uses the tracked count when there is an upstream', async () => {
    const s = await probeGitStatus('/repo', runner({ 'rev-parse': 'main\n', 'status': '## main...origin/main [ahead 2]\n M a\n' }))
    expect(s).toEqual({ isRepo: true, branch: 'main', dirty: true, ahead: 2 })
  })

  it('reports a folder that is not a repository', async () => {
    const s = await probeGitStatus('/tmp', runner({ 'rev-parse': new Error('not a git repository') }))
    expect(s).toEqual({ isRepo: false, branch: null, dirty: false, ahead: 0 })
  })
})
