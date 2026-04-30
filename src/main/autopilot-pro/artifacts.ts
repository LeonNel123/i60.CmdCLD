// Artifact registry for Autopilot PRO. Reads/writes the four first-class
// artifacts (spec / plan / impl-doc / review) and tracks approval state in
// .autopilot-pro/state.json with atomic writes (write-to-tmp then rename).
//
// State layout (state.json):
//   {
//     "spec.md":       { path, kind, approved, sha256, approvedAt, refineCount },
//     "plan.md":       { ... },
//     "impl/m1.md":    { ... },
//     "reviews/m1.md": { ... }
//   }
//
// A change to an artifact's sha256 after approval auto-unapproves it. Callers
// re-fetch via readArtifact + readState to detect this on each cycle.

import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  renameSync, unlinkSync, appendFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import type { ArtifactKind, ArtifactState } from './types'
import { PRO_DIR } from './types'

// ----- path helpers -----

function relativePath(kind: ArtifactKind, phaseId?: string): string {
  switch (kind) {
    case 'spec':     return 'spec.md'
    case 'plan':     return 'plan.md'
    case 'impl-doc':
      if (!phaseId) throw new Error(`artifact kind "impl-doc" requires phaseId`)
      return `impl/${phaseId}.md`
    case 'review':
      if (!phaseId) throw new Error(`artifact kind "review" requires phaseId`)
      return `reviews/${phaseId}.md`
    case 'final-review': return 'final-review.md'
  }
}

function absPath(projectPath: string, kind: ArtifactKind, phaseId?: string): string {
  return join(projectPath, PRO_DIR, relativePath(kind, phaseId))
}

function statePath(projectPath: string): string {
  return join(projectPath, PRO_DIR, 'state.json')
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

// ----- atomic JSON write (tmp + rename) -----

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  // Windows + Linux: rename is atomic on the same filesystem.
  try {
    renameSync(tmp, filePath)
  } catch (e) {
    // Cleanup tmp file if rename fails for any reason.
    try { unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}

// ----- public API -----

export interface ReadArtifactResult {
  content: string | null
  sha256: string | null
}

export function readArtifact(projectPath: string, kind: ArtifactKind, phaseId?: string): ReadArtifactResult {
  const path = absPath(projectPath, kind, phaseId)
  if (!existsSync(path)) return { content: null, sha256: null }
  const content = readFileSync(path, 'utf-8')
  return { content, sha256: sha256(content) }
}

export function writeArtifact(projectPath: string, kind: ArtifactKind, content: string, phaseId?: string): void {
  const path = absPath(projectPath, kind, phaseId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  // Update state.json: register the artifact (or refresh sha256 + auto-unapprove if changed).
  const state = readState(projectPath)
  const rel = relativePath(kind, phaseId)
  const existing = state[rel]
  const newSha = sha256(content)
  const approved = existing?.approved && existing.sha256 === newSha
  state[rel] = {
    path: rel,
    kind,
    approved: approved ?? false,
    sha256: newSha,
    approvedAt: approved ? (existing?.approvedAt ?? null) : null,
    refineCount: existing?.refineCount ?? 0,
  }
  writeState(projectPath, state)
}

export function markApproved(projectPath: string, kind: ArtifactKind, phaseId?: string): void {
  const state = readState(projectPath)
  const rel = relativePath(kind, phaseId)
  const { sha256: currentSha } = readArtifact(projectPath, kind, phaseId)
  const existing = state[rel]
  state[rel] = {
    path: rel,
    kind,
    approved: true,
    sha256: currentSha,
    approvedAt: Date.now(),
    refineCount: existing?.refineCount ?? 0,
  }
  writeState(projectPath, state)
}

export function markUnapproved(projectPath: string, kind: ArtifactKind, phaseId?: string): void {
  const state = readState(projectPath)
  const rel = relativePath(kind, phaseId)
  const existing = state[rel]
  if (!existing) return
  state[rel] = { ...existing, approved: false, approvedAt: null }
  writeState(projectPath, state)
}

export function incrementRefineCount(projectPath: string, kind: ArtifactKind, phaseId?: string): number {
  const state = readState(projectPath)
  const rel = relativePath(kind, phaseId)
  const existing = state[rel] ?? {
    path: rel, kind, approved: false, sha256: null, approvedAt: null, refineCount: 0,
  }
  const next: ArtifactState = { ...existing, refineCount: existing.refineCount + 1 }
  state[rel] = next
  writeState(projectPath, state)
  return next.refineCount
}

export function readState(projectPath: string): Record<string, ArtifactState> {
  const path = statePath(projectPath)
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, ArtifactState>
    return {}
  } catch {
    // Corrupt state.json — return empty rather than crash. The next write will overwrite.
    return {}
  }
}

export function writeState(projectPath: string, state: Record<string, ArtifactState>): void {
  atomicWriteJson(statePath(projectPath), state)
}

/**
 * Reconcile state.json against the artifact files on disk. For every entry in
 * state.json: if the file's current sha256 differs from the recorded one, mark
 * the entry unapproved (the user or doer modified the artifact since approval).
 * Returns the reconciled state.
 */
export function reconcile(projectPath: string): Record<string, ArtifactState> {
  const state = readState(projectPath)
  let dirty = false
  for (const [rel, entry] of Object.entries(state)) {
    const path = join(projectPath, PRO_DIR, rel)
    if (!existsSync(path)) continue
    const current = sha256(readFileSync(path, 'utf-8'))
    if (entry.sha256 !== current) {
      state[rel] = { ...entry, approved: false, sha256: current, approvedAt: null }
      dirty = true
    }
  }
  if (dirty) writeState(projectPath, state)
  return state
}

/**
 * Apply a spec-update DELTA: append a "## Updates (<ts>)" section to spec.md
 * AND append a one-line entry to spec-changelog.md. Recomputes spec.md's
 * sha256 and updates state.json — but PRESERVES approved=true (the delta is
 * the application of an already-approved decision, not a fresh edit).
 */
export function appendSpecUpdate(projectPath: string, deltaBody: string): void {
  const specPath = join(projectPath, PRO_DIR, 'spec.md')
  const changelogPath = join(projectPath, PRO_DIR, 'spec-changelog.md')
  mkdirSync(dirname(specPath), { recursive: true })

  const ts = new Date().toISOString()
  const block = `\n\n## Updates (${ts})\n\n${deltaBody}\n`
  appendFileSync(specPath, block)

  const flat = deltaBody.replace(/\s+/g, ' ').trim().slice(0, 100)
  appendFileSync(changelogPath, `- ${ts} applied: ${flat}\n`)

  // Synchronous append + writeState; no event-loop yield between them, so
  // reconcile() can never observe a stale sha256 in state.json.
  // Recompute spec.md sha256 and update state.json — KEEP approved=true.
  const newContent = readFileSync(specPath, 'utf-8')
  const newSha = sha256(newContent)
  const state = readState(projectPath)
  const existing = state['spec.md']
  state['spec.md'] = {
    path: 'spec.md',
    kind: 'spec',
    approved: existing?.approved ?? false,
    sha256: newSha,
    approvedAt: existing?.approvedAt ?? null,
    refineCount: existing?.refineCount ?? 0,
  }
  writeState(projectPath, state)
}
