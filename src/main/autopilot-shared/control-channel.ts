import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type BaseMarkerKind = 'WAITING' | 'PROGRESS' | 'GOAL_READY' | 'STUCK'
export type BaseProgressStatus = 'done' | 'partial' | 'blocked'
export type BaseRedPhase = 'yes' | 'no' | 'na'

const BASE_KINDS: BaseMarkerKind[] = ['WAITING', 'PROGRESS', 'GOAL_READY', 'STUCK']
const BASE_PROGRESS: BaseProgressStatus[] = ['done', 'partial', 'blocked']

export interface BaseControlMarker {
  kind: BaseMarkerKind
  text: string
  raw: string
  subgoalId?: string
  status?: BaseProgressStatus
  filesChanged?: string[]
  tests?: string
  redPhase?: BaseRedPhase
  boundaryOk?: boolean
  evidence?: string
  blocker?: string
  question?: string
}

export interface ControlMarkerRead<M extends BaseControlMarker> {
  id: string
  marker: M
  mtimeMs: number
}

export interface ControlMarkerValidationError {
  reason: string
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
  return items.length ? items : undefined
}
function asRedPhase(value: unknown): BaseRedPhase | undefined {
  return value === 'yes' || value === 'no' || value === 'na' ? value : undefined
}

export function validateBaseFields(raw: unknown):
  | { id: string; marker: BaseControlMarker; obj: Record<string, unknown> }
  | ControlMarkerValidationError {
  if (!raw || typeof raw !== 'object') return { reason: 'marker.json is not an object' }
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== 1) return { reason: 'schemaVersion must be 1' }
  const id = asString(obj.id)
  if (!id) return { reason: 'id is required' }
  const kind = asString(obj.kind)
  if (!kind || !BASE_KINDS.includes(kind as BaseMarkerKind)) {
    return { reason: 'kind must be WAITING, PROGRESS, GOAL_READY, or STUCK' }
  }
  const subgoalId = asString(obj.subgoalId)
  const status = asString(obj.status)
  if (kind === 'PROGRESS') {
    if (!subgoalId) return { reason: 'subgoalId is required for PROGRESS' }
    if (!status || !(BASE_PROGRESS as readonly string[]).includes(status)) {
      return { reason: 'status must be done, partial, or blocked for PROGRESS' }
    }
  }
  const marker: BaseControlMarker = {
    kind: kind as BaseMarkerKind,
    text: asString(obj.text) ?? asString(obj.question) ?? '',
    raw: `[ORCH:${kind}]${asString(obj.text) ? ` ${asString(obj.text)}` : ''}`,
  }
  if (subgoalId) marker.subgoalId = subgoalId
  if (status && (BASE_PROGRESS as readonly string[]).includes(status)) {
    marker.status = status as BaseProgressStatus
  }
  const filesChanged = asStringArray(obj.filesChanged)
  if (filesChanged) marker.filesChanged = filesChanged
  const tests = asString(obj.tests); if (tests) marker.tests = tests
  const redPhase = asRedPhase(obj.redPhase); if (redPhase) marker.redPhase = redPhase
  if (typeof obj.boundaryOk === 'boolean') marker.boundaryOk = obj.boundaryOk
  const evidence = asString(obj.evidence); if (evidence) marker.evidence = evidence
  const blocker = asString(obj.blocker); if (blocker) marker.blocker = blocker
  const question = asString(obj.question); if (question) marker.question = question
  return { id, marker, obj }
}

export interface ControlChannelOptions<M extends BaseControlMarker> {
  dir: string
  /** Called with the raw object and the already-validated base marker.
   *  May enrich the marker with additional fields, or return a validation error. */
  validateExtra?: (obj: Record<string, unknown>, base: BaseControlMarker) =>
    | { marker: M }
    | ControlMarkerValidationError
}

export interface ControlChannel<M extends BaseControlMarker> {
  readControlMarker(projectPath: string): ControlMarkerRead<M> | ControlMarkerValidationError | null
  writeInboxReply(projectPath: string, text: string): void
  markerToSnapshot<S extends { text: string; marker: M; receivedAt: number }>(
    marker: M, receivedAt?: number,
  ): S
}

export function makeControlChannel<M extends BaseControlMarker = BaseControlMarker>(
  opts: ControlChannelOptions<M>,
): ControlChannel<M> {
  const { dir } = opts
  const outboxPath = join(dir, 'outbox', 'marker.json')
  const inboxPath = join(dir, 'inbox', 'reply.txt')

  return {
    readControlMarker(projectPath) {
      const path = join(projectPath, outboxPath)
      if (!existsSync(path)) return null
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'))
        const base = validateBaseFields(parsed)
        if ('reason' in base) return base
        const enriched = opts.validateExtra
          ? opts.validateExtra(base.obj, base.marker)
          : { marker: base.marker as unknown as M }
        if ('reason' in enriched) return enriched
        return { id: base.id, marker: enriched.marker, mtimeMs: statSync(path).mtimeMs }
      } catch (e: any) {
        return { reason: `marker.json could not be read: ${e?.message ?? 'unknown'}` }
      }
    },
    writeInboxReply(projectPath, text) {
      const path = join(projectPath, inboxPath)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`)
    },
    markerToSnapshot(marker, receivedAt = Date.now()) {
      return { text: 'file-control-channel', marker, receivedAt } as any
    },
  }
}
