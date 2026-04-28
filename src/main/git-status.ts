import { execFile } from 'child_process'

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  dirty: boolean
}

const cache = new Map<string, { value: GitStatus; at: number }>()
const TTL_MS = 30_000
const TIMEOUT_MS = 2_000

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err)
      resolve(stdout.toString())
    })
  })
}

async function probe(path: string): Promise<GitStatus> {
  try {
    const branch = (await runGit(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (!branch) return { isRepo: false, branch: null, dirty: false }
    let dirty = false
    try {
      const status = await runGit(path, ['status', '--porcelain'])
      dirty = status.trim().length > 0
    } catch {
      // status failed but rev-parse worked — call it clean
      dirty = false
    }
    return { isRepo: true, branch, dirty }
  } catch {
    return { isRepo: false, branch: null, dirty: false }
  }
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  const cached = cache.get(path)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  const value = await probe(path)
  cache.set(path, { value, at: Date.now() })
  return value
}

export function clearGitStatusCache(path?: string): void {
  if (path) cache.delete(path)
  else cache.clear()
}
