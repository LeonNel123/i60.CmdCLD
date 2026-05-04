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
  lastError: string
  resolve: (result: ReviewerSessionResult) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 120_000

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
      const pending: PendingReview = {
        buffer: '',
        lastError: 'No JSON object found in reviewer output',
        resolve,
        timer: setTimeout(() => {
          this.finishPendingReview(pending, this.resultFromTimedOutReview(pending))
        }, timeoutMs),
      }

      this.pendingReview = pending
      this.opts.writeToPty(this.opts.terminalId, packetMarkdown + '\r')
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
    const parsed = parseReviewerDecision(pending.buffer)
    if (!parsed.ok) {
      pending.lastError = parsed.error
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
    if (pending.buffer.trim().length === 0) return { kind: 'timeout', raw: pending.buffer }
    return { kind: 'invalid', error: pending.lastError, raw: pending.buffer }
  }

  private resultFromStoppedReview(): ReviewerSessionResult {
    const pending = this.pendingReview
    if (pending === null || pending.buffer.trim().length === 0) return { kind: 'timeout', raw: pending?.buffer ?? '' }
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
