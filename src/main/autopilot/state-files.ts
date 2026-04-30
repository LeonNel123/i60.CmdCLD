import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'
import type { Goal, Milestone, Subgoal, ActivityEntry } from './types'

const DIR = '.autopilot'
const MILESTONES_DIR = '.autopilot/milestones'

function autopilotDir(projectPath: string): string {
  return join(projectPath, DIR)
}

// ---- goal.md ----

export function readGoal(projectPath: string): Goal | null {
  const path = join(projectPath, DIR, 'goal.md')
  try {
    if (!existsSync(path)) return null
    return parseGoal(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function writeGoal(projectPath: string, goal: Goal): void {
  const path = join(projectPath, DIR, 'goal.md')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, formatGoal(goal))
}

function formatGoal(g: Goal): string {
  const lines: string[] = []
  lines.push('# Goal')
  lines.push('')
  lines.push(g.goal)
  lines.push('')
  lines.push('## Non-goals')
  for (const n of g.nonGoals) lines.push(`- ${n}`)
  lines.push('')
  lines.push('## Acceptance')
  for (const a of g.acceptance) lines.push(`- ${a.kind}: ${a.value}`)
  lines.push('')
  lines.push('## Constraints')
  lines.push(`- max_iterations: ${g.constraints.maxIterations}`)
  lines.push(`- max_api_cost_usd: ${g.constraints.maxApiCostUsd}`)
  lines.push(`- max_doer_output_per_reset: ${g.constraints.maxDoerOutputPerReset}`)
  lines.push('')
  return lines.join('\n')
}

function parseGoal(text: string): Goal | null {
  const sections = collectSections(text)
  const goalLines = sections['# Goal'] ?? []
  const goalLine = goalLines.find((l) => l.trim().length > 0)
  if (!goalLine) return null

  const nonGoals = (sections['## Non-goals'] ?? [])
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)

  const acceptance: Goal['acceptance'] = []
  for (const l of sections['## Acceptance'] ?? []) {
    const m = l.match(/^- (shell|judge): (.+)$/)
    if (m) acceptance.push({ kind: m[1] as 'shell' | 'judge', value: m[2].trim() })
  }

  const constraintLines = sections['## Constraints'] ?? []
  const findKv = (key: string): string | null => {
    for (const l of constraintLines) {
      const m = l.match(new RegExp(`^- ${key}:\\s*(.+)$`))
      if (m) return m[1].trim()
    }
    return null
  }
  const maxIterations = Number(findKv('max_iterations') ?? '40')
  const maxApiCostUsd = Number(findKv('max_api_cost_usd') ?? '1.0')
  const maxDoerOutputPerReset = Number(findKv('max_doer_output_per_reset') ?? '60000')

  if (!Number.isFinite(maxIterations) || !Number.isFinite(maxApiCostUsd) || !Number.isFinite(maxDoerOutputPerReset)) return null

  return {
    goal: goalLine.trim(),
    nonGoals,
    acceptance,
    constraints: { maxIterations, maxApiCostUsd, maxDoerOutputPerReset },
  }
}

function collectSections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let current: string | null = null
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) {
      current = line.trim()
      out[current] = []
      continue
    }
    if (current) out[current].push(line)
  }
  return out
}

// ---- milestones/mN.md ----

export function readMilestones(projectPath: string): Milestone[] {
  const dir = join(projectPath, MILESTONES_DIR)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  const out: Milestone[] = []
  for (const f of files) {
    try {
      const m = parseMilestone(readFileSync(join(dir, f), 'utf-8'), f.replace(/\.md$/, ''))
      if (m) out.push(m)
    } catch {
      // skip
    }
  }
  return out
}

export function writeMilestone(projectPath: string, m: Milestone): void {
  const path = join(projectPath, MILESTONES_DIR, `${m.id}.md`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, formatMilestone(m))
}

function formatMilestone(m: Milestone): string {
  const lines: string[] = []
  lines.push(`# Milestone ${m.id} — ${m.name}`)
  lines.push('')
  lines.push(`Status: ${m.status}`)
  lines.push('')
  lines.push('## Subgoals')
  for (const s of m.subgoals) {
    const tick = s.status === 'done' ? 'x' : s.status === 'partial' ? '~' : s.status === 'blocked' ? '!' : ' '
    lines.push(`- [${tick}] ${s.id}: ${s.description}`)
    if (s.shell) lines.push(`  - shell: ${s.shell}`)
    if (s.judge) lines.push(`  - judge: ${s.judge}`)
    if (s.boundary) {
      if (s.boundary.allowedFiles?.length) {
        lines.push(`  - boundary.allowed: ${s.boundary.allowedFiles.join(', ')}`)
      }
      if (s.boundary.forbiddenFiles?.length) {
        lines.push(`  - boundary.forbidden: ${s.boundary.forbiddenFiles.join(', ')}`)
      }
      if (s.boundary.allowedDeps?.length) {
        lines.push(`  - boundary.deps: ${s.boundary.allowedDeps.join(', ')}`)
      }
    }
  }
  lines.push('')
  lines.push('## Notes')
  lines.push(m.notes)
  lines.push('')
  return lines.join('\n')
}

function parseMilestone(text: string, fileId: string): Milestone | null {
  const sections = collectSections(text)
  const titleLine = Object.keys(sections).find((k) => /^# Milestone /.test(k))
  if (!titleLine) return null
  const titleMatch = titleLine.match(/^# Milestone (\S+)\s*[—-]?\s*(.+)?$/)
  const id = titleMatch?.[1] ?? fileId
  const name = (titleMatch?.[2] ?? '').trim()
  const statusLine = (sections[titleLine] ?? []).find((l) => l.startsWith('Status:'))
  const status = (statusLine?.replace('Status:', '').trim() as Milestone['status']) ?? 'pending'
  const subgoals: Subgoal[] = []
  let pending: Subgoal | null = null
  for (const l of sections['## Subgoals'] ?? []) {
    const main = l.match(/^- \[([x~! ])\] (\S+): (.+)$/)
    if (main) {
      if (pending) subgoals.push(pending)
      const tick = main[1]
      pending = {
        id: main[2],
        description: main[3].trim(),
        status: tick === 'x' ? 'done' : tick === '~' ? 'partial' : tick === '!' ? 'blocked' : 'pending',
      }
      continue
    }
    const sub = l.match(/^\s+- (shell|judge): (.+)$/)
    if (sub && pending) {
      if (sub[1] === 'shell') pending.shell = sub[2].trim()
      else pending.judge = sub[2].trim()
      continue
    }
    const bnd = l.match(/^\s+- boundary\.(allowed|forbidden|deps): (.+)$/)
    if (bnd && pending) {
      const items = bnd[2].split(',').map((x) => x.trim()).filter(Boolean)
      if (!pending.boundary) pending.boundary = {}
      if (bnd[1] === 'allowed') pending.boundary.allowedFiles = items
      else if (bnd[1] === 'forbidden') pending.boundary.forbiddenFiles = items
      else pending.boundary.allowedDeps = items
    }
  }
  if (pending) subgoals.push(pending)
  const notes = ((sections['## Notes'] ?? []).join('\n')).trim()
  return { id, name, status, subgoals, notes }
}

// ---- log.md ----

export function appendLog(projectPath: string, entry: ActivityEntry): void {
  const path = join(projectPath, DIR, 'log.md')
  mkdirSync(dirname(path), { recursive: true })
  const line = `- ${new Date(entry.at).toISOString()} | ${entry.kind} | ${entry.summary}\n`
  appendFileSync(path, line)
}

// ---- state.md (overwrite each time) ----

export function readState(projectPath: string): string {
  const path = join(projectPath, DIR, 'state.md')
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

export function writeState(projectPath: string, content: string): void {
  const path = join(projectPath, DIR, 'state.md')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

// ---- helpers ----

export function autopilotDirExists(projectPath: string): boolean {
  return existsSync(autopilotDir(projectPath))
}
