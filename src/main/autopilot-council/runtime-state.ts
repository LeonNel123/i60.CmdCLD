import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { councilPath } from './state-files'
import type { CouncilGate, CouncilState } from './types'

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
  const path = councilPath(projectPath, 'runtime.json')
  const tmpPath = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(tmpPath, JSON.stringify({ state, internals }, null, 2))
  renameSync(tmpPath, path)
}

export function loadCouncilRuntime(projectPath: string): CouncilRuntimeSnapshot | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(councilPath(projectPath, 'runtime.json'), 'utf-8'))
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (!isRecord(parsed.state) || parsed.state.mode !== 'council') return null
  if (!isRecord(parsed.internals) || typeof parsed.internals.packetSequence !== 'number') return null

  return parsed as unknown as CouncilRuntimeSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
