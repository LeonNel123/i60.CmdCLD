import { existsSync, statSync } from 'fs'

export interface PtyCreateRequest {
  id: string
  cwd: string
  /** Whether the invoking event resolved to a live window + webContents. */
  hasWindow: boolean
  /** Whether a terminal already exists under this id. */
  idInUse: boolean
}

/** Check a pty:create request. Returns null when it may proceed, otherwise a
 *  message explaining the refusal.
 *
 *  These used to be bare `return`s in the IPC handler, which resolved the
 *  invoke with undefined: the renderer's .catch() never fired and the tile sat
 *  there blank with no way to tell why. Every rejection now carries a reason
 *  the renderer can print into the terminal.
 */
export function validatePtyCreate(req: PtyCreateRequest): string | null {
  if (!req.hasWindow) return 'No owning window for this request.'
  if (req.idInUse) return `Terminal "${req.id}" already exists.`
  if (!req.cwd) return 'No folder given for this terminal.'
  try {
    if (!existsSync(req.cwd)) return `Folder not found: ${req.cwd}`
    if (!statSync(req.cwd).isDirectory()) return `Not a folder: ${req.cwd}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `Cannot open folder ${req.cwd}: ${msg}`
  }
  return null
}
