/**
 * Turning a typed folder path into the one spelling the app stores.
 *
 * A folder's path is a key: recents, favourites and the per-folder agent
 * memory are all looked up by the exact string. The native picker always
 * hands back the canonical spelling; a path typed into the browser page did
 * not, so `d:/2026/foo`, `D:\2026\foo\` and `"D:\2026\foo"` each became their
 * own project — or, with the quotes, a tile that failed to start.
 */
import { realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { cleanFolderInput } from '../shared/folder-input'

export type ResolvedFolder = { ok: true; path: string } | { ok: false; error: string }

export function resolveFolderInput(raw: unknown): ResolvedFolder {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a folder path.' }
  let input = cleanFolderInput(raw)
  if (!input) return { ok: false, error: 'Enter a folder path.' }

  if (input === '~') input = homedir()
  else if (input.startsWith('~/') || input.startsWith('~\\')) input = join(homedir(), input.slice(2))

  // Relative to what? The app's working directory is wherever it was started.
  if (!isAbsolute(input)) return { ok: false, error: 'Use the full path to the folder.' }

  // Separators, `..`, and a trailing separator.
  let path = resolve(input)

  try {
    if (!statSync(path).isDirectory()) return { ok: false, error: `Not a folder: ${path}` }
  } catch {
    return { ok: false, error: `Folder not found: ${path}` }
  }

  if (process.platform === 'win32') {
    // Windows ignores case; the stored key must not. Take the casing the file
    // system reports — but only when that is the same path. realpath also
    // follows links and turns a mapped drive into its UNC name, and neither
    // is what the person asked to open.
    try {
      const real = realpathSync.native(path)
      if (real.toLowerCase() === path.toLowerCase()) path = real
    } catch {}
    if (/^[a-z]:/.test(path)) path = path[0].toUpperCase() + path.slice(1)
  }
  return { ok: true, path }
}
