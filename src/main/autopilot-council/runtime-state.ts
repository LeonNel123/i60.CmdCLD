import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { councilPath } from './state-files'
import { isCouncilGate, isCouncilIntensity } from './types'
import type { CouncilControl, CouncilGate, CouncilState } from './types'

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
const REVIEWER_STATUSES = new Set(['idle', 'starting', 'reviewing', 'timed-out', 'protocol-violation', 'failed'])

function isCouncilStateShape(value: unknown): value is CouncilState {
  if (!isRecord(value)) return false

  return (
    value.mode === 'council' &&
    typeof value.stage === 'string' &&
    typeof value.control === 'string' &&
    CONTROLS.has(value.control as CouncilControl) &&
    typeof value.terminalId === 'string' &&
    typeof value.reviewerTerminalId === 'string' &&
    typeof value.implementerCli === 'string' &&
    typeof value.reviewerCli === 'string' &&
    isCouncilIntensity(value.intensity) &&
    Number.isFinite(value.cycleCount) &&
    Number.isFinite(value.costUsd) &&
    Number.isFinite(value.costCapUsd) &&
    Array.isArray(value.recentLog) &&
    typeof value.reviewerStatus === 'string' &&
    REVIEWER_STATUSES.has(value.reviewerStatus)
  )
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
