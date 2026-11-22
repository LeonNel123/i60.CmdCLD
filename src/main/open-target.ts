/**
 * Opening a file that was clicked in a terminal, with the OS default program.
 *
 * Three things the bare `shell.openPath` call did not do:
 *  - say when the file is not there. The open failed, the fallback "reveal"
 *    of a missing file showed nothing, and the click looked dead;
 *  - refuse to run things. "Open with the default program" executes a .bat
 *    or .exe, and this takes any path it is sent — including one from a
 *    file:// link a program printed. Those are shown in their folder;
 *  - report which of the two happened, so the renderer can tell the user.
 */
import { fileURLToPath } from 'url'
import { terminalLinkAction } from '../shared/terminal-link'

export interface OpenTargetDeps {
  exists(path: string): boolean
  /** Resolves to '' on success, or the reason it failed (shell.openPath). */
  openPath(path: string): Promise<string>
  reveal(path: string): void
}

export interface OpenTargetResult {
  ok: boolean
  error?: string
  /** The file was shown in its folder instead of (or after failing to be) opened. */
  revealed?: boolean
}

export async function openFileTarget(target: unknown, deps: OpenTargetDeps): Promise<OpenTargetResult> {
  if (typeof target !== 'string' || !target) return { ok: false, error: 'Nothing to open.' }
  let path = target
  if (/^file:/i.test(path)) {
    try { path = fileURLToPath(path) } catch { /* not a valid file URL — try as-is */ }
  } else if (/^\/{2,}[A-Za-z]:/.test(path)) {
    path = path.replace(/^\/+/, '') // strip leading slashes off a "///C:/…" path
  }

  if (!deps.exists(path)) return { ok: false, error: `File not found: ${path}` }

  if (terminalLinkAction(path) === 'reveal') {
    deps.reveal(path)
    return { ok: true, revealed: true }
  }

  try {
    const error = await deps.openPath(path)
    if (!error) return { ok: true }
    // No associated app: show it in its folder so the click still lands somewhere.
    deps.reveal(path)
    return { ok: false, error, revealed: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
