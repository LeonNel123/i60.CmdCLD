// Markdown phase tracker for Autopilot PRO Wave 3.1.
//
// Reads plan.md and extracts a structured phase list. The state machine reads
// this on every cycle to decide when to advance from implementation → phase-review
// → next phase / final-review. Status is DERIVED, never persisted.
//
// Header shapes accepted (anchored at start of line):
//   ## Phase 1: name
//   ## Phase 2 — name      (em-dash)
//   ## Phase 2 - name      (hyphen)
//   ## Phase alpha: name   (non-numeric id)
//
// Task list items under each phase (indented up to 4 spaces):
//   - [ ] T<id>: <description>
//   - [x] <description>     (auto-id T1, T2, ...)
//
// If parsing fails completely, returns []. The state machine treats empty
// phase list as "stay in implementation" (existing Wave 3.0 behaviour).

import type { PhaseDescriptor, TaskDescriptor } from './types'

const PHASE_HEADER_RE = /^##\s+Phase\s+([^\s:—-]+)\s*[:—-]\s*(.+?)\s*$/i
const TASK_RE = /^\s{0,4}-\s+\[([ xX])\]\s+(?:T(\d+)\s*[:.\-]\s+)?(.+?)\s*$/

export function parsePhases(planMarkdown: string): PhaseDescriptor[] {
  if (!planMarkdown) return []
  const lines = planMarkdown.split(/\r?\n/)
  const phases: PhaseDescriptor[] = []
  let current: PhaseDescriptor | null = null
  let autoIdCounter = 1

  for (const line of lines) {
    const headerMatch = line.match(PHASE_HEADER_RE)
    if (headerMatch) {
      if (current) phases.push(current)
      const rawId = headerMatch[1].toLowerCase()
      current = {
        id: `phase-${rawId}`,
        name: headerMatch[2].trim(),
        tasks: [],
        status: 'pending',
      }
      autoIdCounter = 1
      continue
    }

    if (!current) continue

    const taskMatch = line.match(TASK_RE)
    if (taskMatch) {
      const done = taskMatch[1].toLowerCase() === 'x'
      const explicitId = taskMatch[2]
      const description = taskMatch[3]
      const task: TaskDescriptor = {
        id: explicitId ? `T${explicitId}` : `T${autoIdCounter}`,
        description,
        done,
      }
      autoIdCounter++
      current.tasks.push(task)
    }
  }
  if (current) phases.push(current)

  for (const p of phases) p.status = deriveStatus(p)

  return phases
}

function deriveStatus(p: PhaseDescriptor): PhaseDescriptor['status'] {
  if (p.tasks.length === 0) return 'pending'
  const doneCount = p.tasks.filter((t) => t.done).length
  if (doneCount === p.tasks.length) return 'done'
  if (doneCount === 0) return 'pending'
  return 'in-progress'
}

export function currentPhase(phases: PhaseDescriptor[]): PhaseDescriptor | null {
  for (const p of phases) {
    if (p.status !== 'done') return p
  }
  return null
}

export function phaseDoneFromTasks(phase: PhaseDescriptor): boolean {
  if (phase.tasks.length === 0) return false
  return phase.tasks.every((t) => t.done)
}
