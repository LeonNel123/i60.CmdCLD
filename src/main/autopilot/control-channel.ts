import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { DoerMarker, MarkerKind, Milestone, SettledSnapshot } from './types'

const DIR = '.autopilot'
const OUTBOX_MARKER = join(DIR, 'outbox', 'marker.json')
const INBOX_REPLY = join(DIR, 'inbox', 'reply.txt')

export interface ControlMarkerRead {
  id: string
  marker: DoerMarker
  mtimeMs: number
}

export interface ControlMarkerValidationError {
  reason: string
}

const MARKER_KINDS: MarkerKind[] = ['WAITING', 'PROGRESS', 'GOAL_READY', 'STUCK']
const PROGRESS_STATUSES = ['done', 'partial', 'blocked'] as const

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length ? items : undefined
}

function asRedPhase(value: unknown): DoerMarker['redPhase'] | undefined {
  return value === 'yes' || value === 'no' || value === 'na' ? value : undefined
}

function validateControlMarkerObject(raw: unknown): { id: string; marker: DoerMarker } | ControlMarkerValidationError {
  if (!raw || typeof raw !== 'object') return { reason: 'marker.json is not an object' }
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== 1) return { reason: 'schemaVersion must be 1' }

  const id = asString(obj.id)
  if (!id) return { reason: 'id is required' }

  const kind = asString(obj.kind)
  if (!kind || !MARKER_KINDS.includes(kind as MarkerKind)) return { reason: 'kind must be WAITING, PROGRESS, GOAL_READY, or STUCK' }

  const subgoalId = asString(obj.subgoalId)
  const status = asString(obj.status)
  if (kind === 'PROGRESS') {
    if (!subgoalId) return { reason: 'subgoalId is required for PROGRESS' }
    if (!status || !(PROGRESS_STATUSES as readonly string[]).includes(status)) {
      return { reason: 'status must be done, partial, or blocked for PROGRESS' }
    }
  }

  const marker: DoerMarker = {
    kind: kind as MarkerKind,
    text: asString(obj.text) ?? asString(obj.question) ?? '',
    raw: `[ORCH:${kind}]${asString(obj.text) ? ` ${asString(obj.text)}` : ''}`,
  }

  if (subgoalId) marker.subgoalId = subgoalId
  if (status && (PROGRESS_STATUSES as readonly string[]).includes(status)) {
    marker.status = status as DoerMarker['status']
  }

  const filesChanged = asStringArray(obj.filesChanged)
  if (filesChanged) marker.filesChanged = filesChanged

  const tests = asString(obj.tests)
  if (tests) marker.tests = tests

  const redPhase = asRedPhase(obj.redPhase)
  if (redPhase) marker.redPhase = redPhase

  if (typeof obj.boundaryOk === 'boolean') marker.boundaryOk = obj.boundaryOk

  const evidence = asString(obj.evidence)
  if (evidence) marker.evidence = evidence

  const blocker = asString(obj.blocker)
  if (blocker) marker.blocker = blocker

  const question = asString(obj.question)
  if (question) marker.question = question

  return { id, marker }
}

export function readControlMarker(projectPath: string): ControlMarkerRead | ControlMarkerValidationError | null {
  const path = join(projectPath, OUTBOX_MARKER)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    const validated = validateControlMarkerObject(parsed)
    if ('reason' in validated) return validated
    return {
      ...validated,
      mtimeMs: statSync(path).mtimeMs,
    }
  } catch (error: any) {
    return { reason: `marker.json could not be read: ${error?.message ?? 'unknown'}` }
  }
}

export function writeInboxReply(projectPath: string, text: string): void {
  const path = join(projectPath, INBOX_REPLY)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`)
}

export function markerToSnapshot(marker: DoerMarker, receivedAt = Date.now()): SettledSnapshot {
  return {
    text: 'file-control-channel',
    marker,
    receivedAt,
  }
}

export function reconcileMilestoneState(memory: Milestone[], disk: Milestone[]): { changed: boolean; milestones: Milestone[] } {
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
