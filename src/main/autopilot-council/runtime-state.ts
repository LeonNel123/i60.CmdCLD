import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { councilPath } from './state-files'
import { isCouncilGate, isCouncilIntensity, isReviewerRisk, isReviewerVerdict } from './types'
import type { CouncilArbitrationAction, CouncilControl, CouncilGate, CouncilState, ProStage } from './types'

export interface CouncilRuntimeInternals {
  packetSequence: number
  repeatedBlockByGate: Partial<Record<CouncilGate, number>>
}

export interface CouncilRuntimeSnapshot {
  state: CouncilState
  internals: CouncilRuntimeInternals
}

export function saveCouncilRuntime(
  projectPath: string,
  state: CouncilState,
  internals: CouncilRuntimeInternals,
): void {
  if (!isCouncilStateShape(state)) {
    throw new Error('Invalid council runtime state')
  }

  if (!isCouncilRuntimeInternalsShape(internals)) {
    throw new Error('Invalid council runtime internals')
  }

  const path = councilPath(projectPath, 'runtime.json')
  const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  mkdirSync(dirname(path), { recursive: true })

  try {
    writeFileSync(tmpPath, JSON.stringify({ state, internals }, null, 2))
    renameSync(tmpPath, path)
  } catch (error) {
    if (existsSync(tmpPath)) rmSync(tmpPath, { force: true })
    throw error
  }
}

export function loadCouncilRuntime(projectPath: string): CouncilRuntimeSnapshot | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(councilPath(projectPath, 'runtime.json'), 'utf-8'))
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (!isCouncilStateShape(parsed.state)) return null
  if (!isCouncilRuntimeInternalsShape(parsed.internals)) return null

  return parsed as unknown as CouncilRuntimeSnapshot
}

const CONTROLS = new Set<CouncilControl>(['idle', 'running', 'paused', 'blocked', 'stopped'])
const STAGES = new Set<ProStage>(['research', 'discovery', 'planning', 'implementation', 'phase-review', 'final-review', 'done'])
const AGENT_CLIS = new Set(['claude', 'codex'])
const ARBITRATION_ACTIONS = new Set<CouncilArbitrationAction>([
  'continue',
  'instruct-implementer',
  'implementer-wins',
  'ask-user',
  'retry-reviewer',
  'ignore-reviewer',
])
const REVIEWER_STATUSES = new Set(['idle', 'starting', 'reviewing', 'timed-out', 'protocol-violation', 'failed'])
const ACTIVITY_KINDS = new Set([
  'doer-marker',
  'orchestrator-reply',
  'orchestrator-reset',
  'orchestrator-pause',
  'orchestrator-resume',
  'cost-threshold',
  'escalation',
  'research-dispatch',
  'research-write',
  'research-overrun',
  'research-decline',
  'research-reuse',
  'research-stage-complete',
  'research-stage-entered',
])

function isCouncilStateShape(value: unknown): value is CouncilState {
  if (!isRecord(value)) return false

  return (
    value.mode === 'council' &&
    typeof value.stage === 'string' &&
    STAGES.has(value.stage as ProStage) &&
    typeof value.control === 'string' &&
    CONTROLS.has(value.control as CouncilControl) &&
    typeof value.terminalId === 'string' &&
    (typeof value.reviewerTerminalId === 'string' || value.reviewerTerminalId === null) &&
    typeof value.implementerCli === 'string' &&
    AGENT_CLIS.has(value.implementerCli) &&
    typeof value.reviewerCli === 'string' &&
    AGENT_CLIS.has(value.reviewerCli) &&
    isCouncilIntensity(value.intensity) &&
    isHumanApprovalShape(value.humanApproval) &&
    isNonNegativeInteger(value.cycleCount) &&
    isNonNegativeFiniteNumber(value.costUsd) &&
    isNonNegativeFiniteNumber(value.costCapUsd) &&
    isValidationCommandsShape(value.validation) &&
    Array.isArray(value.recentLog) &&
    value.recentLog.every(isActivityEntryShape) &&
    isNullableString(value.liveStatus) &&
    isNullableString(value.escalationReason) &&
    isLastMarkerShape(value.lastMarker) &&
    isCouncilArbitrationResultShape(value.lastCouncilDecision) &&
    isNullableString(value.lastReviewPacketId) &&
    typeof value.reviewerStatus === 'string' &&
    REVIEWER_STATUSES.has(value.reviewerStatus) &&
    isNullableString(value.reviewerWarning) &&
    isPermissionRequestShape(value.permissionRequest)
  )
}

function isHumanApprovalShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.highRiskDisagreement === 'boolean' &&
    typeof value.reviewerEscalation === 'boolean' &&
    typeof value.repeatedHighRiskBlock === 'boolean' &&
    typeof value.beforeEveryPhase === 'boolean' &&
    typeof value.beforeCommit === 'boolean'
  )
}

function isValidationCommandsShape(value: unknown): boolean {
  if (!isRecord(value)) return false

  return ['test', 'build', 'typecheck', 'lint'].every((key) => value[key] === undefined || typeof value[key] === 'string')
}

function isActivityEntryShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isFinite(value.at) &&
    typeof value.kind === 'string' &&
    ACTIVITY_KINDS.has(value.kind) &&
    typeof value.summary === 'string'
  )
}

function isLastMarkerShape(value: unknown): boolean {
  if (value === null) return true
  if (!isRecord(value)) return false

  return (
    typeof value.kind === 'string' &&
    (value.subgoalId === undefined || typeof value.subgoalId === 'string') &&
    (value.status === undefined || typeof value.status === 'string') &&
    Number.isFinite(value.receivedAt)
  )
}

function isCouncilArbitrationResultShape(value: unknown): boolean {
  if (value === null) return true
  if (!isRecord(value)) return false

  return (
    typeof value.action === 'string' &&
    ARBITRATION_ACTIONS.has(value.action as CouncilArbitrationAction) &&
    isCouncilGate(value.gate) &&
    isReviewerRisk(value.risk) &&
    typeof value.instruction === 'string' &&
    typeof value.reason === 'string' &&
    (isReviewerVerdict(value.reviewerVerdict) || value.reviewerVerdict === 'timeout' || value.reviewerVerdict === 'invalid')
  )
}

function isPermissionRequestShape(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    typeof value.text === 'string' &&
    Number.isFinite(value.detectedAt)
  )
}

function isNullableString(value: unknown): boolean {
  return typeof value === 'string' || value === null
}

function isCouncilRuntimeInternalsShape(value: unknown): value is CouncilRuntimeInternals {
  if (!isRecord(value)) return false

  return isNonNegativeInteger(value.packetSequence) && isRepeatedBlockByGateShape(value.repeatedBlockByGate)
}

function isRepeatedBlockByGateShape(value: unknown): value is CouncilRuntimeInternals['repeatedBlockByGate'] {
  if (!isRecord(value)) return false

  return Object.entries(value).every(([gate, count]) => isCouncilGate(gate) && isNonNegativeInteger(count))
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
