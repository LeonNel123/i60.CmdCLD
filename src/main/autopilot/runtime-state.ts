import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import type { AutopilotState, AutopilotPhase, Milestone } from './types'

interface RuntimeFlagsClassic {
  markerFallbackPromptCount: number
  partialStreak: number
  outputVolumeSinceReset: number
}

interface RuntimeStateClassic extends RuntimeFlagsClassic {
  schemaVersion: 1
  savedAt: number
  phase: AutopilotPhase
  currentMilestoneId: string | null
  cycleCount: number
  costUsd: number
}

const DIR = '.autopilot'

function runtimePath(projectPath: string): string {
  return join(projectPath, DIR, 'runtime.json')
}

export function saveRuntimeClassic(projectPath: string, state: AutopilotState, flags: RuntimeFlagsClassic): void {
  const path = runtimePath(projectPath)
  mkdirSync(dirname(path), { recursive: true })
  const payload: RuntimeStateClassic = {
    schemaVersion: 1,
    savedAt: Date.now(),
    phase: state.phase,
    currentMilestoneId: state.currentMilestoneId,
    cycleCount: state.cycleCount,
    costUsd: state.costUsd,
    ...flags,
  }
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(payload, null, 2))
  try {
    renameSync(tmp, path)
  } catch {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}

export function loadRuntimeClassic(projectPath: string, milestones: Milestone[]): RuntimeStateClassic | null {
  const path = runtimePath(projectPath)
  if (!existsSync(path)) return null
  let parsed: RuntimeStateClassic
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
    if (!parsed || parsed.schemaVersion !== 1) {
      markStale(path)
      return null
    }
  } catch {
    markStale(path)
    return null
  }

  if (parsed.currentMilestoneId !== null && !milestones.some((m) => m.id === parsed.currentMilestoneId)) {
    markStale(path)
    return null
  }

  return parsed
}

function markStale(path: string): void {
  try {
    if (!existsSync(path)) return
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const stalePath = `${path}.stale-${ts}`
    if (existsSync(stalePath)) return
    renameSync(path, stalePath)
  } catch { /* best effort */ }
}

export type { RuntimeStateClassic, RuntimeFlagsClassic }
