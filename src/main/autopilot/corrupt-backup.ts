import { existsSync, copyFileSync } from 'fs'

/**
 * Copy a corrupt file to <path>.corrupt-<ISO timestamp> so forensics
 * survive an automated reset. Best-effort — failures are swallowed.
 *
 * Idempotent within a single millisecond: if the timestamped backup
 * already exists, this no-ops.
 */
export function backupCorrupt(path: string): void {
  try {
    if (!existsSync(path)) return
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${path}.corrupt-${ts}`
    if (existsSync(backupPath)) return
    copyFileSync(path, backupPath)
  } catch {
    // best effort — never throw from a backup call
  }
}
