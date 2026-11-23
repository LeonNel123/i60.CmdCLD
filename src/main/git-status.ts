import { execFile } from 'child_process'

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  dirty: boolean
  /** Commits that exist only here: ahead of the upstream, or, on a branch with
   *  no upstream, on no remote at all. */
  ahead: number
  /** The folder is a repository but its state could not be read (git timed
   *  out or failed). `dirty` and `ahead` are then not known, not zero. */
  unknown?: true
}

const cache = new Map<string, { value: GitStatus; at: number }>()
const TTL_MS = 30_000
// `git status` walks the working tree; a few seconds is normal on a large
// repository or a cold disk.
const TIMEOUT_MS = 6_000

type RunGit = (cwd: string, args: string[]) => Promise<string>

const runGit: RunGit = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
    if (err) return reject(err)
    resolve(stdout.toString())
  })
})

/** Reads `git status --porcelain --branch`. */
export function parsePorcelainStatus(output: string): { dirty: boolean; ahead: number; hasUpstream: boolean } {
  const lines = output.split(/\r?\n/)
  const header = lines[0] || ''
  const aheadMatch = header.match(/\[ahead (\d+)/)
  return {
    dirty: lines.slice(1).some((l) => l.trim().length > 0),
    ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
    // "## local...remote/branch": three dots, which a ref name cannot contain.
    hasUpstream: /^## \S+\.\.\.\S+/.test(header),
  }
}

export async function probeGitStatus(path: string, run: RunGit = runGit): Promise<GitStatus> {
  let branch: string
  try {
    branch = (await run(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return { isRepo: false, branch: null, dirty: false, ahead: 0 }
  }
  if (!branch) return { isRepo: false, branch: null, dirty: false, ahead: 0 }
  try {
    const status = parsePorcelainStatus(await run(path, ['status', '--porcelain', '--branch']))
    let ahead = status.ahead
    if (!status.hasUpstream) {
      // Never pushed: nothing to be "ahead" of. Count what no remote has,
      // unless there is no remote for it to be missing from.
      const hasRemote = (await run(path, ['remote'])).trim().length > 0
      if (hasRemote) {
        ahead = parseInt((await run(path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim(), 10) || 0
      }
    }
    return { isRepo: true, branch, dirty: status.dirty, ahead }
  } catch {
    return { isRepo: true, branch, dirty: false, ahead: 0, unknown: true }
  }
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  const cached = cache.get(path)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  const value = await probeGitStatus(path)
  // An answer of "could not tell" is not worth remembering.
  if (!value.unknown) cache.set(path, { value, at: Date.now() })
  return value
}

export function clearGitStatusCache(path?: string): void {
  if (path) cache.delete(path)
  else cache.clear()
}
