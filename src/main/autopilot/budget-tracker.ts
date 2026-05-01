import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

const DEFAULT_PROJECT_CAP = 5
const DEFAULT_GLOBAL_CAP = 20
const WARNING_THRESHOLD = 0.8

export interface BudgetState {
  schemaVersion: 1
  date: string
  perProject: Record<string, { spentUsd: number; capUsd: number; capExplicit?: boolean }>
  global: { spentUsd: number; capUsd: number }
}

export interface BudgetSnapshot {
  projectSpent: number
  projectCap: number
  globalSpent: number
  globalCap: number
  capReached: boolean
  capReachedReason: 'project' | 'global' | null
  warningThreshold: boolean
}

let _budgetPath: string | null = null

function budgetPath(): string {
  if (_budgetPath) return _budgetPath
  return join(homedir(), '.cmdcld', 'cost-budget.json')
}

/** Test hook only. */
export function _setBudgetPathForTest(path: string): void {
  _budgetPath = path
}

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultState(): BudgetState {
  return {
    schemaVersion: 1,
    date: todayLocal(),
    perProject: {},
    global: { spentUsd: 0, capUsd: DEFAULT_GLOBAL_CAP },
  }
}

function rolloverIfNeeded(state: BudgetState): BudgetState {
  const today = todayLocal()
  if (state.date === today) return state
  // Reset spend, preserve caps
  const preservedGlobalCap = state.global.capUsd
  const preservedProjectCaps: Record<string, number> = {}
  for (const [k, v] of Object.entries(state.perProject)) {
    preservedProjectCaps[k] = v.capUsd
  }
  return {
    schemaVersion: 1,
    date: today,
    perProject: Object.fromEntries(
      Object.entries(preservedProjectCaps).map(([k, capUsd]) => [k, { spentUsd: 0, capUsd }])
    ),
    global: { spentUsd: 0, capUsd: preservedGlobalCap },
  }
}

export function loadBudget(): BudgetState {
  const path = budgetPath()
  if (!existsSync(path)) return defaultState()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as BudgetState
    if (!parsed || parsed.schemaVersion !== 1) return defaultState()
    return rolloverIfNeeded(parsed)
  } catch {
    return defaultState()
  }
}

function saveBudget(state: BudgetState): void {
  const path = budgetPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  try {
    renameSync(tmp, path)
  } catch {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}

function ensureProject(state: BudgetState, projectPath: string): void {
  if (!state.perProject[projectPath]) {
    state.perProject[projectPath] = { spentUsd: 0, capUsd: DEFAULT_PROJECT_CAP, capExplicit: false }
  }
}

export function recordSpend(projectPath: string, deltaUsd: number): BudgetSnapshot {
  const state = loadBudget()
  ensureProject(state, projectPath)
  state.perProject[projectPath].spentUsd += deltaUsd
  state.global.spentUsd += deltaUsd
  saveBudget(state)
  return computeSnapshot(state, projectPath)
}

export function getSnapshot(projectPath: string): BudgetSnapshot {
  const state = loadBudget()
  ensureProject(state, projectPath)
  saveBudget(state)
  return computeSnapshot(state, projectPath)
}

function computeSnapshot(state: BudgetState, projectPath: string): BudgetSnapshot {
  const project = state.perProject[projectPath] ?? { spentUsd: 0, capUsd: DEFAULT_PROJECT_CAP, capExplicit: false }
  // Per-project cap only enforced when explicitly configured
  const projectCapActive = project.capExplicit === true
  const projectReached = projectCapActive && project.spentUsd >= project.capUsd
  const globalReached = state.global.spentUsd >= state.global.capUsd
  const projectWarning = projectCapActive && project.spentUsd >= project.capUsd * WARNING_THRESHOLD
  const globalWarning = state.global.spentUsd >= state.global.capUsd * WARNING_THRESHOLD
  return {
    projectSpent: project.spentUsd,
    projectCap: project.capUsd,
    globalSpent: state.global.spentUsd,
    globalCap: state.global.capUsd,
    capReached: projectReached || globalReached,
    capReachedReason: projectReached ? 'project' : globalReached ? 'global' : null,
    warningThreshold: (projectWarning || globalWarning) && !(projectReached || globalReached),
  }
}

export function setProjectCap(projectPath: string, capUsd: number): void {
  const state = loadBudget()
  ensureProject(state, projectPath)
  state.perProject[projectPath].capUsd = capUsd
  state.perProject[projectPath].capExplicit = true
  saveBudget(state)
}

export function setGlobalCap(capUsd: number): void {
  const state = loadBudget()
  state.global.capUsd = capUsd
  saveBudget(state)
}

export function resetTodaySpend(): void {
  const state = loadBudget()
  for (const k of Object.keys(state.perProject)) {
    state.perProject[k].spentUsd = 0
  }
  state.global.spentUsd = 0
  saveBudget(state)
}
