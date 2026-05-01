import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import type { ProState, ProStage, ArtifactState } from './types'
import { PRO_DIR } from './types'
import { parsePhases } from './phases'

interface RuntimeFlags {
  markerFallbackPromptCount: number
  stage3KickoffSentForPhase: string | null
  stage4KickoffSent: boolean
  metaAutoFired: boolean
  phaseTrackerEscalated: boolean
  outputVolumeSinceReset: number
}

interface RuntimeStatePro extends RuntimeFlags {
  schemaVersion: 1
  savedAt: number
  stage: ProStage
  currentPhaseId: string | null
  currentTaskId: string | null
  cycleCount: number
  costUsd: number
  researchInFlight?: {
    triggerStage: ProStage
    pendingTopics: string[]
    spendByTopic: Record<string, number>
    topicBudgets: Record<string, number>
  }
  researchHistory?: { slug: string; costUsd: number; outcome: 'written' | 'declined' | 'overrun' | 'reused' }[]
}

function runtimePath(projectPath: string): string {
  return join(projectPath, PRO_DIR, 'runtime.json')
}

export function saveRuntime(projectPath: string, state: ProState, flags: RuntimeFlags): void {
  const path = runtimePath(projectPath)
  mkdirSync(dirname(path), { recursive: true })
  const payload: RuntimeStatePro = {
    schemaVersion: 1,
    savedAt: Date.now(),
    stage: state.stage,
    currentPhaseId: state.currentPhaseId,
    currentTaskId: state.currentTaskId,
    cycleCount: state.cycleCount,
    costUsd: state.costUsd,
    ...flags,
    ...(state.researchInFlight ? { researchInFlight: state.researchInFlight } : {}),
    ...(state.researchHistory ? { researchHistory: state.researchHistory } : {}),
  }
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(payload, null, 2))
  try {
    renameSync(tmp, path)
  } catch {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}

export function loadRuntime(projectPath: string, artifacts: Record<string, ArtifactState>): RuntimeStatePro | null {
  const path = runtimePath(projectPath)
  if (!existsSync(path)) return null
  let parsed: RuntimeStatePro
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

  if (!validate(parsed, projectPath, artifacts)) {
    markStale(path)
    return null
  }

  return parsed
}

function validate(rt: RuntimeStatePro, projectPath: string, artifacts: Record<string, ArtifactState>): boolean {
  if (rt.currentPhaseId !== null) {
    const planPath = join(projectPath, PRO_DIR, 'plan.md')
    if (!existsSync(planPath)) return false
    const planText = readFileSync(planPath, 'utf-8')
    const phases = parsePhases(planText)
    if (!phases.some((p) => p.id === rt.currentPhaseId)) return false
  }

  if (rt.stage4KickoffSent) {
    const finalReviewPath = join(projectPath, PRO_DIR, 'final-review.md')
    const hasFinalReview = existsSync(finalReviewPath)
    const reviewEntries = Object.entries(artifacts).filter(([k]) => k.startsWith('reviews/'))
    const allReviewsApproved = reviewEntries.length > 0 && reviewEntries.every(([, a]) => a.approved)
    if (!hasFinalReview && !allReviewsApproved) return false
  }

  // Self-validate researchInFlight: an empty pendingTopics list is inconsistent
  // (it should have been cleared once empty). Drop it rather than fail the load.
  if (rt.researchInFlight && rt.researchInFlight.pendingTopics.length === 0) {
    rt.researchInFlight = undefined
  }

  return true
}

function markStale(path: string): void {
  try {
    if (!existsSync(path)) return
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const stalePath = `${path}.stale-${ts}`
    if (existsSync(stalePath)) return
    renameSync(path, stalePath)
  } catch {
    // best effort
  }
}

export type { RuntimeStatePro, RuntimeFlags }
