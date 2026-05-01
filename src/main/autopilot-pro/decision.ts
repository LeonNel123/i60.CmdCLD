// Shape-aware planner call for Autopilot PRO.
//
// PRO's decision pipeline differs from Classic's: instead of one universal
// `decide(input) → DecideResult` call with a single output schema, PRO uses
// six different shapes, each with its own output schema and prompt template.
// This module wraps `client.chat({ system, user })` (the low-level method
// added in api-client.ts) and parses the per-shape JSON response.
//
// Recovery: if JSON.parse fails or the schema doesn't match, we try to
// extract the first balanced {...} block (same trick as parseDecision in
// the classic api-client). On total failure we fall back to a safe `reply`
// shape carrying the raw text — same degradation as Classic.

import type { ApiClient, ApiUsage } from '../autopilot/types'
import type { DecisionShape, ProDecideInput, ProDecideResult } from './types'
import { buildPlannerPrompt } from './prompts'

// ----- balanced-brace extractor (same algorithm as classic) -----

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// ----- per-shape JSON validators -----

function validate(shape: DecisionShape, obj: any): ProDecideResult | null {
  if (!obj || typeof obj !== 'object') return null
  if (typeof obj.shape !== 'string' || obj.shape !== shape) return null

  switch (shape) {
    case 'reply':
      if (typeof obj.text !== 'string') return null
      return { shape: 'reply', text: String(obj.text) }

    case 'choose':
      if (typeof obj.option !== 'string' || !obj.option) return null
      return { shape: 'choose', option: String(obj.option), why: String(obj.why ?? '') }

    case 'approve':
      if (obj.verdict === 'approve') {
        return { shape: 'approve', verdict: 'approve', why: String(obj.why ?? '') }
      }
      if (obj.verdict === 'refine') {
        return {
          shape: 'approve',
          verdict: 'refine',
          directive: String(obj.directive ?? 'be more specific').slice(0, 500),
        }
      }
      return null

    case 'route':
      if (typeof obj.skill !== 'string' || !obj.skill) return null
      return { shape: 'route', skill: String(obj.skill), why: String(obj.why ?? '') }

    case 'validate':
      if (obj.verdict === 'verified') return { shape: 'validate', verdict: 'verified' }
      if (obj.verdict === 'research') {
        return { shape: 'validate', verdict: 'research', query: String(obj.query ?? '').slice(0, 300) }
      }
      return null

    case 'transition':
      if (obj.action !== 'advance' && obj.action !== 'cycle' && obj.action !== 'final-review') return null
      return { shape: 'transition', action: obj.action, why: String(obj.why ?? '') }

    case 'decide-with-rationale':
      if (typeof obj.recommendation !== 'string' || !obj.recommendation) return null
      return { shape: 'decide-with-rationale', recommendation: String(obj.recommendation), why: String(obj.why ?? '') }
  }
}

// ----- public: parseProDecision -----

/**
 * Parse a planner response string into a typed ProDecideResult for the
 * given expected shape. Tries direct parse → balanced-brace extraction →
 * safe fallback. Safe fallback is always shape='reply' carrying the raw
 * stripped text (same shape as classic parseDecision).
 */
export function parseProDecision(shape: DecisionShape, text: string): ProDecideResult {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  const candidates = [stripped]
  const extracted = extractFirstJsonObject(stripped)
  if (extracted && extracted !== stripped) candidates.push(extracted)

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate)
      const validated = validate(shape, obj)
      if (validated) return validated
    } catch { /* try next */ }
  }

  // Total failure → safe fallback as reply (same as classic parseDecision).
  return { shape: 'reply', text: stripped.slice(0, 1000) }
}

// ----- public: decidePro -----

export interface ProDecideOutput {
  result: ProDecideResult
  usage: ApiUsage
  costUsd: number
}

export async function decidePro(
  client: ApiClient,
  input: ProDecideInput,
): Promise<ProDecideOutput> {
  if (!client.chat) {
    throw new Error('decidePro: ApiClient.chat() is not implemented on this client')
  }
  const parts = buildPlannerPrompt(input)
  const userMsg = parts.cachedGoalAndArtifacts + '\n\n' + parts.uncachedRecent
  const { text, usage } = await client.chat({
    system: parts.cachedSystem,
    user: userMsg,
    maxTokens: 400,
  })
  const result = parseProDecision(input.shape, text)
  const costUsd = client.estimateCost(usage)
  return { result, usage, costUsd }
}

// ----- principles enforcement -----

import { PRINCIPLES } from './types'
import type { ProMarker } from './types'

export interface PrincipleCheckContext {
  marker: ProMarker
  allowedFiles?: string[]
}

export interface PrincipleViolation {
  name: string
  severity: 'hard' | 'soft'
  message: string
}

/**
 * Check the doer's structured marker fields against the principles vector.
 * Returns the list of violations. Hard violations should override an
 * approve verdict to refine; soft violations are informational nudges.
 *
 * Currently checks (Wave 3.0 baseline):
 *   - TDD       (hard): if FILES_CHANGED contains test files but RED_PHASE != 'yes'
 *   - SECURITY  (hard): if FILES_CHANGED has files matching .env / credentials patterns
 *   - BOUNDARY  (hard): if BOUNDARY_OK == false
 */
export function checkPrinciples(ctx: PrincipleCheckContext): PrincipleViolation[] {
  const violations: PrincipleViolation[] = []
  const m = ctx.marker
  const files = m.filesChanged ?? []

  // BOUNDARY (hard) — easiest signal: doer self-reported boundary violation
  if (m.boundaryOk === false) {
    violations.push({
      name: 'BOUNDARY',
      severity: 'hard',
      message: `Doer reported BOUNDARY_OK: no — files outside the task's allowed list were touched.`,
    })
  }

  // TDD (hard) — heuristic: if any test file was changed but RED_PHASE is not 'yes',
  // the doer didn't follow TDD. Skip when no test files were touched.
  const touchedTests = files.some((f) => /\b(test|spec)\b/i.test(f) || /\.test\.|\.spec\./i.test(f))
  if (touchedTests && m.redPhase !== 'yes' && m.redPhase !== 'na') {
    violations.push({
      name: 'TDD',
      severity: 'hard',
      message: `Test files were modified but RED_PHASE != 'yes' — TDD requires a failing test first.`,
    })
  }

  // SECURITY (hard) — heuristic: any file path that looks like a secret store.
  const secretPattern = /(^|\/|\\)(\.env|credentials\.json|secrets?\.(?:json|yaml|yml|toml))$/i
  const secrets = files.filter((f) => secretPattern.test(f))
  if (secrets.length) {
    violations.push({
      name: 'SECURITY',
      severity: 'hard',
      message: `Diff touches secret-bearing files: ${secrets.join(', ')}.`,
    })
  }

  return violations
}

/**
 * Apply principles to an approve-shape verdict. If hard violations exist,
 * override approve→refine with a directive listing the violations. Soft
 * violations don't change the verdict but are returned alongside.
 */
export function applyPrinciplesToApprove(
  result: Extract<ProDecideResult, { shape: 'approve' }>,
  ctx: PrincipleCheckContext,
): { result: Extract<ProDecideResult, { shape: 'approve' }>; violations: PrincipleViolation[] } {
  const violations = checkPrinciples(ctx)
  const hardViolations = violations.filter((v) => v.severity === 'hard')
  if (result.verdict === 'approve' && hardViolations.length > 0) {
    const directive = `Hard-principle violations: ${hardViolations.map((v) => v.name).join(', ')}. ${hardViolations[0].message}`
    return {
      result: { shape: 'approve', verdict: 'refine', directive: directive.slice(0, 500) },
      violations,
    }
  }
  return { result, violations }
}

// Re-export PRINCIPLES for convenience (consumers don't have to also
// import from types).
export { PRINCIPLES }
