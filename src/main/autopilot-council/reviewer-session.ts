import { randomUUID } from 'node:crypto'
import type { AgentCli } from '../../shared/agent-cli'
import { parseReviewerDecision } from './packets'
import { buildCouncilReviewerPrompt } from './prompts'
import type { ReviewerDecision } from './types'

export type ReviewerSessionResult =
  | { kind: 'decision'; decision: ReviewerDecision; raw: string }
  | { kind: 'invalid'; error: string; raw: string }
  | { kind: 'timeout'; raw: string }

export interface CouncilReviewerSessionOptions {
  terminalId: string
  reviewerCli: AgentCli
  writeToPty: (terminalId: string, data: string) => void
  onPtyData: (terminalId: string, listener: (data: string) => void) => () => void
  timeoutMs?: number
}

interface PendingReview {
  buffer: string
  hasRelevantOutput: boolean
  lastError: string
  requestId: string
  resolve: (result: ReviewerSessionResult) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 120_000
const NO_MATCHING_REQUEST_ERROR = 'No reviewer decision found for current request'

export class CouncilReviewerSession {
  private readonly opts: CouncilReviewerSessionOptions
  private readonly promptText: string
  private detach: (() => void) | null = null
  private listenerAttached = false
  private promptSent = false
  private pendingReview: PendingReview | null = null

  constructor(opts: CouncilReviewerSessionOptions) {
    this.opts = opts
    this.promptText = buildCouncilReviewerPrompt(opts.reviewerCli)
  }

  async start(): Promise<void> {
    this.ensureStarted()
  }

  async review(packetMarkdown: string): Promise<ReviewerSessionResult> {
    if (this.pendingReview !== null) {
      return {
        kind: 'invalid',
        error: 'Reviewer session already has a pending review',
        raw: this.pendingReview.buffer,
      }
    }

    this.ensureStarted()

    const timeoutMs = Math.max(0, this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    return new Promise((resolve) => {
      const requestId = createReviewRequestId()
      const pending: PendingReview = {
        buffer: '',
        hasRelevantOutput: false,
        lastError: NO_MATCHING_REQUEST_ERROR,
        requestId,
        resolve,
        timer: setTimeout(() => {
          this.finishPendingReview(pending, this.resultFromTimedOutReview(pending))
        }, timeoutMs),
      }

      this.pendingReview = pending
      this.opts.writeToPty(this.opts.terminalId, frameReviewPacket(packetMarkdown, requestId) + '\r')
    })
  }

  stop(): void {
    this.finishPendingReview(this.pendingReview, this.resultFromStoppedReview())

    if (this.detach !== null) {
      this.detach()
      this.detach = null
      this.listenerAttached = false
      this.promptSent = false
    }
  }

  private ensureStarted(): void {
    if (this.detach === null && !this.listenerAttached) {
      this.detach = this.opts.onPtyData(this.opts.terminalId, (data) => {
        this.handlePtyData(data)
      })
      this.listenerAttached = true
    }

    if (!this.promptSent) {
      this.opts.writeToPty(this.opts.terminalId, this.promptText + '\r')
      this.promptSent = true
    }
  }

  private handlePtyData(data: string): void {
    const pending = this.pendingReview
    if (pending === null) return

    pending.buffer = this.cleanReviewOutput(pending.buffer + data)
    const parsed = parseReviewerDecisionForRequest(pending.buffer, pending.requestId)
    if (!parsed.ok) {
      pending.lastError = parsed.error
      pending.hasRelevantOutput = pending.hasRelevantOutput || parsed.hasRelevantOutput
      return
    }

    this.finishPendingReview(pending, {
      kind: 'decision',
      decision: parsed.decision,
      raw: pending.buffer,
    })
  }

  private finishPendingReview(pending: PendingReview | null, result: ReviewerSessionResult): void {
    if (pending === null || this.pendingReview !== pending) return

    clearTimeout(pending.timer)
    this.pendingReview = null
    pending.resolve(result)
  }

  private resultFromTimedOutReview(pending: PendingReview): ReviewerSessionResult {
    if (pending.buffer.trim().length === 0 || !pending.hasRelevantOutput) return { kind: 'timeout', raw: pending.buffer }
    return { kind: 'invalid', error: pending.lastError, raw: pending.buffer }
  }

  private resultFromStoppedReview(): ReviewerSessionResult {
    const pending = this.pendingReview
    if (pending === null || pending.buffer.trim().length === 0 || !pending.hasRelevantOutput) {
      return { kind: 'timeout', raw: pending?.buffer ?? '' }
    }
    return { kind: 'invalid', error: pending.lastError, raw: pending.buffer }
  }

  private cleanReviewOutput(text: string): string {
    return stripKnownStaleText(normalizeTerminalText(text), this.promptText)
  }
}

function normalizeTerminalText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function stripKnownStaleText(text: string, promptText: string): string {
  return removeAll(text, normalizeTerminalText(promptText))
}

function removeAll(text: string, staleText: string): string {
  if (staleText.length === 0) return text
  return text.split(staleText).join('')
}

function createReviewRequestId(): string {
  return randomUUID()
}

function frameReviewPacket(packetMarkdown: string, requestId: string): string {
  return [
    `Council Review Request ID: ${requestId}`,
    '',
    'Return JSON only for this review.',
    `Your JSON object must include a top-level "request_id" property exactly equal to ${requestId}.`,
    'Do not copy JSON objects from this packet. Do not use markdown fences.',
    '',
    packetMarkdown,
  ].join('\n')
}

function parseReviewerDecisionForRequest(
  text: string,
  requestId: string,
): { ok: true; decision: ReviewerDecision } | { ok: false; error: string; hasRelevantOutput: boolean } {
  const candidates = extractBalancedJsonObjects(text)
  let hasRelevantOutput = false
  let lastError = NO_MATCHING_REQUEST_ERROR
  let sawIgnoredReviewerDecision = false

  for (const candidate of candidates) {
    const parsedJson = parseJson(candidate)
    if (!parsedJson.ok) {
      if (containsCurrentRequestId(candidate, requestId)) {
        hasRelevantOutput = true
        lastError = parsedJson.error
      }
      continue
    }

    const value = parsedJson.value
    if (!isRecord(value)) continue

    if (value.request_id !== requestId) {
      const ignoredDecision = parseReviewerDecision(JSON.stringify(value))
      if (ignoredDecision.ok) sawIgnoredReviewerDecision = true
      continue
    }

    const parsedDecision = parseReviewerDecision(JSON.stringify(value))
    if (parsedDecision.ok) return { ok: true, decision: parsedDecision.decision }

    hasRelevantOutput = true
    lastError = parsedDecision.error
  }

  return {
    ok: false,
    error: sawIgnoredReviewerDecision ? 'Reviewer decision did not match current request_id' : lastError,
    hasRelevantOutput,
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

function containsCurrentRequestId(text: string, requestId: string): boolean {
  return new RegExp(`"request_id"\\s*:\\s*"${escapeRegExp(requestId)}"`).test(text)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractBalancedJsonObjects(text: string): string[] {
  const candidates: string[] = []

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue

    const candidate = extractBalancedJsonObjectFrom(text, start)
    if (candidate !== null) candidates.push(candidate)
  }

  return candidates
}

function extractBalancedJsonObjectFrom(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
    } else if (char === '\\' && inString) {
      escaped = true
    } else if (char === '"') {
      inString = !inString
    } else if (!inString && char === '{') {
      depth += 1
    } else if (!inString && char === '}') {
      depth -= 1

      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
