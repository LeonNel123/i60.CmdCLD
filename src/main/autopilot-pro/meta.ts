// Meta-orchestrator for Autopilot PRO.
//
// Runs AFTER a completed PRO run. Reads transcript / cost / spec / reviews,
// asks the planner LLM to classify the result as:
//   - done             — original spec satisfied; no obvious follow-up
//   - extend           — review surfaced a coherent next slice; drafts next-spec
//   - human-required   — material decisions surfaced; lists open questions
//
// Writes one of three output files based on classification:
//   .autopilot-pro/final-summary.md       (done)
//   .autopilot-pro/next-spec-draft.md     (extend)
//   .autopilot-pro/escalation-summary.md  (human-required)
//
// Does NOT auto-start a follow-up run on extend — the user reviews and approves
// the draft to chain. This is the "exit-point router" analogue of cc-sdd's
// kiro-discovery skill.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import type { ApiClient } from '../autopilot/types'
import type { MetaReflectResult, MetaClassification } from './types'
import { PRO_DIR } from './types'
import { META_REFLECT_SYSTEM_PROMPT, buildMetaReflectPrompt } from './prompts'

// ----- inputs gathered from disk -----

interface MetaInputs {
  spec: string
  plan: string
  reviews: Array<{ phaseId: string; content: string }>
  transcriptExcerpt: string
  costUsd: number
}

function gatherInputs(projectPath: string): MetaInputs {
  const dir = join(projectPath, PRO_DIR)
  const spec = readFileIfExists(join(dir, 'spec.md'))
  const plan = readFileIfExists(join(dir, 'plan.md'))
  const transcript = readFileIfExists(join(dir, 'transcript.md'))
  // Tail of transcript only (last 4KB).
  const transcriptExcerpt = transcript.slice(-4000)

  // Cost — try to parse from cost.json; default 0 if absent or malformed.
  let costUsd = 0
  const costPath = join(dir, 'cost.json')
  if (existsSync(costPath)) {
    try {
      const parsed = JSON.parse(readFileSync(costPath, 'utf-8'))
      if (typeof parsed?.totalUsd === 'number') costUsd = parsed.totalUsd
    } catch { /* ignore */ }
  }

  // All review files in reviews/ — sorted by name.
  const reviewsDir = join(dir, 'reviews')
  const reviews: Array<{ phaseId: string; content: string }> = []
  if (existsSync(reviewsDir)) {
    const entries = readdirSync(reviewsDir).filter((f) => f.endsWith('.md')).sort()
    for (const f of entries) {
      reviews.push({
        phaseId: f.replace(/\.md$/, ''),
        content: readFileSync(join(reviewsDir, f), 'utf-8'),
      })
    }
  }

  return { spec, plan, reviews, transcriptExcerpt, costUsd }
}

function readFileIfExists(path: string): string {
  if (!existsSync(path)) return ''
  try { return readFileSync(path, 'utf-8') } catch { return '' }
}

// ----- response parsing -----

function parseMetaResponse(text: string): MetaReflectResult {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  // Try direct parse, then balanced-brace extraction (same recovery as the
  // classic / PRO decision parsers).
  const candidates: string[] = [stripped]
  const start = stripped.indexOf('{')
  if (start > 0) {
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < stripped.length; i++) {
      const c = stripped[i]
      if (escape) { escape = false; continue }
      if (c === '\\') { escape = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          candidates.push(stripped.slice(start, i + 1))
          break
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate)
      if (!obj || typeof obj !== 'object') continue
      const cls = obj.classification
      if (cls !== 'done' && cls !== 'extend' && cls !== 'human-required') continue
      const summary = String(obj.summary ?? '').slice(0, 500)
      if (cls === 'extend') {
        return {
          classification: 'extend',
          summary,
          draftSpec: typeof obj.draftSpec === 'string' ? obj.draftSpec : '(draft missing)',
        }
      }
      if (cls === 'human-required') {
        return {
          classification: 'human-required',
          summary,
          openQuestions: Array.isArray(obj.openQuestions) ? obj.openQuestions.map(String) : [],
        }
      }
      return { classification: 'done', summary }
    } catch { /* try next */ }
  }

  // Total failure → human-required, conservative default.
  return {
    classification: 'human-required',
    summary: 'meta-reflect failed: planner response unparseable',
    openQuestions: ['What should we do next?'],
  }
}

// ----- output files -----

function writeOutputFile(projectPath: string, kind: MetaClassification, content: string): void {
  const filename = kind === 'done' ? 'final-summary.md'
    : kind === 'extend' ? 'next-spec-draft.md'
    : 'escalation-summary.md'
  const path = join(projectPath, PRO_DIR, filename)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function renderDoneSummary(result: MetaReflectResult, costUsd: number): string {
  return [
    '# Final summary',
    '',
    `**Classification:** done`,
    `**Cost:** $${costUsd.toFixed(4)}`,
    '',
    '## Summary',
    '',
    result.summary,
    '',
  ].join('\n')
}

function renderEscalationSummary(result: MetaReflectResult): string {
  const qs = (result.openQuestions ?? []).map((q) => `- ${q}`).join('\n')
  return [
    '# Escalation summary',
    '',
    `**Classification:** human-required`,
    '',
    '## Summary',
    '',
    result.summary,
    '',
    '## Open questions',
    '',
    qs || '(none specified)',
    '',
  ].join('\n')
}

// ----- public: runMetaReflect -----

export async function runMetaReflect(
  client: ApiClient,
  projectPath: string,
): Promise<MetaReflectResult> {
  if (!client.chat) {
    throw new Error('runMetaReflect: ApiClient.chat() is not implemented on this client')
  }

  const inputs = gatherInputs(projectPath)
  const userPrompt = buildMetaReflectPrompt(inputs)

  let text: string
  try {
    const { text: responseText } = await client.chat({
      system: META_REFLECT_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1500,
    })
    text = responseText
  } catch (e: any) {
    // Network / API failure — fall back to a deterministic done summary.
    const fallback: MetaReflectResult = {
      classification: 'done',
      summary: `meta-reflect skipped: ${e?.message ?? 'API error'}. Spec assumed satisfied.`,
    }
    writeOutputFile(projectPath, 'done', renderDoneSummary(fallback, inputs.costUsd))
    return fallback
  }

  const result = parseMetaResponse(text)

  // Write output file based on classification.
  if (result.classification === 'done') {
    writeOutputFile(projectPath, 'done', renderDoneSummary(result, inputs.costUsd))
  } else if (result.classification === 'extend') {
    writeOutputFile(projectPath, 'extend', result.draftSpec ?? '(draft missing)')
  } else {
    writeOutputFile(projectPath, 'human-required', renderEscalationSummary(result))
  }

  return result
}

// Exported for direct testing of the parser.
export { parseMetaResponse, gatherInputs }
