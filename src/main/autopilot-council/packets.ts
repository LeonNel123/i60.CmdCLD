import type {
  CouncilGate,
  ProMarker,
  ProStage,
  ReviewerDecision,
  ReviewerFinding,
  ReviewPacket,
} from './types'
import type { AgentCli } from '../../shared/agent-cli'
import { isReviewerRisk, isReviewerVerdict } from './types'

const ARTIFACT_LIMIT = 4000
const DIFF_LIMIT = 4000
const TERMINAL_TAIL_LIMIT = 4000
const RECENT_DECISION_LIMIT = 8
const FINDING_SEVERITIES = new Set(['info', 'warning', 'blocking'])

export interface BuildReviewPacketArgs {
  sequence: number
  gate: CouncilGate
  stage: ProStage
  projectPath: string
  goalSummary: string
  implementerCli: AgentCli
  reviewerCli: AgentCli
  marker: ProMarker | null
  artifactPath: string | null
  artifactContent: string | null
  diffSummary: string | null
  filesChanged: string[]
  testEvidence: string | null
  recentDecisions: string[]
  terminalTail: string
}

export type ParseReviewerDecisionResult =
  | { ok: true; decision: ReviewerDecision }
  | { ok: false; error: string; raw: string }

export function trimForPacket(text: string, limit: number): string {
  if (text.length <= limit) return text
  const omitted = text.length - limit
  return `[trimmed ${omitted} chars]\n${text.slice(-limit)}`
}

export function buildReviewPacket(args: BuildReviewPacketArgs): ReviewPacket {
  const sequence = String(args.sequence).padStart(3, '0')

  return {
    id: `${sequence}-${args.gate}-review`,
    gate: args.gate,
    stage: args.stage,
    createdAt: Date.now(),
    projectPath: args.projectPath,
    goalSummary: args.goalSummary,
    implementerCli: args.implementerCli,
    reviewerCli: args.reviewerCli,
    marker: args.marker,
    artifactPath: args.artifactPath,
    artifactExcerpt: args.artifactContent === null ? null : trimForPacket(args.artifactContent, ARTIFACT_LIMIT),
    diffSummary: args.diffSummary === null ? null : trimForPacket(args.diffSummary, DIFF_LIMIT),
    filesChanged: [...args.filesChanged],
    testEvidence: args.testEvidence,
    recentDecisions: args.recentDecisions.slice(-RECENT_DECISION_LIMIT),
    terminalTail: trimForPacket(args.terminalTail, TERMINAL_TAIL_LIMIT),
  }
}

export function formatReviewPacketForReviewer(packet: ReviewPacket): string {
  const sections = [
    `# Council Review Packet ${packet.id}`,
    [
      `Gate: ${packet.gate}`,
      `Stage: ${packet.stage}`,
      `Project: ${packet.projectPath}`,
      `Implementer: ${packet.implementerCli}`,
      `Reviewer: ${packet.reviewerCli}`,
    ].join('\n'),
    [
      '## Reviewer Task',
      'Review this bounded packet. Return JSON only with verdict, risk, findings, recommended_instruction, and rationale.',
    ].join('\n'),
    ['## Goal', packet.goalSummary].join('\n'),
  ]

  if (packet.artifactExcerpt !== null) {
    sections.push([
      `## Artifact${packet.artifactPath === null ? '' : `: ${packet.artifactPath}`}`,
      fenced(packet.artifactExcerpt),
    ].join('\n'))
  }

  if (packet.filesChanged.length > 0) {
    sections.push(['## Changed Files', packet.filesChanged.map((file) => `- ${file}`).join('\n')].join('\n'))
  }

  if (packet.diffSummary !== null) {
    sections.push(['## Diff Summary', fenced(packet.diffSummary)].join('\n'))
  }

  if (packet.testEvidence !== null) {
    sections.push(['## Test Evidence', packet.testEvidence].join('\n'))
  }

  if (packet.recentDecisions.length > 0) {
    sections.push(['## Recent Decisions', packet.recentDecisions.map((decision) => `- ${decision}`).join('\n')].join('\n'))
  }

  if (packet.marker !== null) {
    sections.push(['## JSON Marker', fenced(JSON.stringify(packet.marker, null, 2), 'json')].join('\n'))
  }

  if (packet.terminalTail.trim().length > 0) {
    sections.push(['## Terminal Tail', fenced(packet.terminalTail)].join('\n'))
  }

  return sections.join('\n\n')
}

export function parseReviewerDecision(text: string): ParseReviewerDecisionResult {
  const raw = text
  const candidate = stripMarkdownFence(text.trim())
  const direct = parseJson(candidate)
  const parsed = direct.ok ? direct : parseExtractedJson(candidate)

  if (!parsed.ok) return { ok: false, error: parsed.error, raw }

  const validation = validateReviewerDecision(parsed.value)
  if (!validation.ok) return { ok: false, error: validation.error, raw }

  return { ok: true, decision: validation.decision }
}

function fenced(text: string, language = ''): string {
  return `\`\`\`${language}\n${text}\n\`\`\``
}

function stripMarkdownFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : text
}

function parseExtractedJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const extracted = extractFirstBalancedJsonObject(text)
  if (extracted === null) return { ok: false, error: 'No JSON object found in reviewer output' }
  return parseJson(extracted)
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

function extractFirstBalancedJsonObject(text: string): string | null {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (start === -1) {
      if (char === '{') {
        start = index
        depth = 1
      }
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = inString
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return text.slice(start, index + 1)
  }

  return null
}

function validateReviewerDecision(value: unknown): { ok: true; decision: ReviewerDecision } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'Reviewer decision must be a JSON object' }
  if (!isReviewerVerdict(value.verdict)) return { ok: false, error: 'Invalid reviewer verdict' }
  if (!isReviewerRisk(value.risk)) return { ok: false, error: 'Invalid reviewer risk' }
  if (!Array.isArray(value.findings)) return { ok: false, error: 'Invalid reviewer findings' }
  if (typeof value.recommended_instruction !== 'string') {
    return { ok: false, error: 'Invalid reviewer recommended_instruction' }
  }
  if (typeof value.rationale !== 'string') return { ok: false, error: 'Invalid reviewer rationale' }

  const findings: ReviewerFinding[] = []
  for (const finding of value.findings) {
    const parsed = validateReviewerFinding(finding)
    if (!parsed.ok) return parsed
    findings.push(parsed.finding)
  }

  return {
    ok: true,
    decision: {
      verdict: value.verdict,
      risk: value.risk,
      findings,
      recommended_instruction: value.recommended_instruction,
      rationale: value.rationale,
    },
  }
}

function validateReviewerFinding(value: unknown): { ok: true; finding: ReviewerFinding } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'Invalid reviewer finding: must be an object' }
  if (typeof value.title !== 'string') return { ok: false, error: 'Invalid reviewer finding title' }
  if (typeof value.severity !== 'string' || !FINDING_SEVERITIES.has(value.severity)) {
    return { ok: false, error: 'Invalid reviewer finding severity' }
  }
  if (value.file !== undefined && typeof value.file !== 'string') {
    return { ok: false, error: 'Invalid reviewer finding file' }
  }
  if (typeof value.reason !== 'string') return { ok: false, error: 'Invalid reviewer finding reason' }
  if (typeof value.recommended_fix !== 'string') {
    return { ok: false, error: 'Invalid reviewer finding recommended_fix' }
  }

  return {
    ok: true,
    finding: {
      title: value.title,
      severity: value.severity as ReviewerFinding['severity'],
      ...(value.file === undefined ? {} : { file: value.file }),
      reason: value.reason,
      recommended_fix: value.recommended_fix,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
