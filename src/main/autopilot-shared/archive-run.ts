import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'

// Starting a run "fresh" in a project that has run before.
//
// Each orchestrator decides what to do at start from what is on disk: a goal
// and milestones mean "resume executing", a spec means "skip discovery", and
// runtime.json restores the cycle count and cost. That is right for Resume and
// wrong for a new idea, which was silently dropped in favour of the old run.
// So a fresh start first moves the old run aside, inside the same directory
// (it is the one place a project already ignores).

/** Survives a fresh start: the archive itself, and what was learned about the
 *  project rather than about one run. */
const KEEP = new Set(['archive', 'learnings.md'])

/**
 * Moves the previous run's files in `<projectPath>/<controlDir>` to
 * `<controlDir>/archive/<timestamp>/`. Returns the archive folder, or null when
 * there was nothing to move.
 */
export function archivePreviousRun(projectPath: string, controlDir: string, now: () => Date = () => new Date()): string | null {
  const dir = join(projectPath, controlDir)
  if (!existsSync(dir)) return null
  const entries = readdirSync(dir).filter((name) => !KEEP.has(name))
  if (entries.length === 0) return null

  const stamp = now().toISOString().replace(/[:.]/g, '-')
  let target = join(dir, 'archive', stamp)
  for (let n = 2; existsSync(target); n++) target = join(dir, 'archive', `${stamp}-${n}`)
  mkdirSync(target, { recursive: true })
  for (const name of entries) renameSync(join(dir, name), join(target, name))
  return target
}
