import type { DoerMarker, Milestone, SettledSnapshot } from './types'
import {
  makeControlChannel,
  validateBaseFields,
  type ControlMarkerValidationError,
  type ControlMarkerRead,
} from '../autopilot-shared/control-channel'

const channel = makeControlChannel<DoerMarker>({ dir: '.autopilot' })

export type { ControlMarkerValidationError }
export type ClassicControlMarkerRead = ControlMarkerRead<DoerMarker>

export function readControlMarker(projectPath: string):
  ClassicControlMarkerRead | ControlMarkerValidationError | null {
  return channel.readControlMarker(projectPath)
}

export function writeInboxReply(projectPath: string, text: string): void {
  channel.writeInboxReply(projectPath, text)
}

export function markerToSnapshot(marker: DoerMarker, receivedAt = Date.now()): SettledSnapshot {
  return { text: 'file-control-channel', marker, receivedAt }
}

// Re-export base validator for tests / callers that exercised it directly.
export function validateControlMarkerObject(raw: unknown):
  | { id: string; marker: DoerMarker }
  | ControlMarkerValidationError {
  const r = validateBaseFields(raw)
  if ('reason' in r) return r
  return { id: r.id, marker: r.marker as DoerMarker }
}

// Classic-only milestone reconciliation — unchanged.
export function reconcileMilestoneState(memory: Milestone[], disk: Milestone[]):
  { changed: boolean; milestones: Milestone[] } {
  const byId = new Map(disk.map((m) => [m.id, m]))
  let changed = false
  const reconciled = memory.map((m) => {
    const diskMilestone = byId.get(m.id)
    if (!diskMilestone) return m
    const diskSubgoals = new Map(diskMilestone.subgoals.map((s) => [s.id, s]))
    const subgoals = m.subgoals.map((s) => {
      const diskSubgoal = diskSubgoals.get(s.id)
      if (!diskSubgoal || diskSubgoal.status === s.status) return s
      changed = true
      return { ...s, status: diskSubgoal.status }
    })
    const allDone = subgoals.every((s) => s.status === 'done')
    const anyBlocked = subgoals.some((s) => s.status === 'blocked')
    const anyStarted = subgoals.some((s) => s.status !== 'pending')
    const status = anyBlocked ? 'blocked' : allDone ? 'done' : anyStarted ? 'in-progress' : 'pending'
    if (status !== m.status) changed = true
    return { ...m, subgoals, status }
  })
  return { changed, milestones: reconciled }
}
