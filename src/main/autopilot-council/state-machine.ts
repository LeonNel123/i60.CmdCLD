import { existsSync, readFileSync } from 'fs'
import { isAbsolute, join, normalize, relative, resolve } from 'path'
import { discoverValidation } from '../autopilot/validation'
import { PtyWatcher } from '../autopilot/pty-watcher'
import { enrichProMarker } from '../autopilot-pro/state-machine'
import { stage0Kickoff } from '../autopilot-pro/prompts'
import { arbitrateCouncilReview } from './arbitration'
import { buildReviewPacket, formatReviewPacketForReviewer } from './packets'
import { buildCouncilImplementerPrompt } from './prompts'
import { CouncilReviewerSession, type ReviewerSessionResult } from './reviewer-session'
import { loadCouncilRuntime, saveCouncilRuntime } from './runtime-state'
import { appendCouncilDecision, readRecentCouncilDecisions, writeReviewPacketFiles } from './state-files'
import {
  COUNCIL_GATES_BY_INTENSITY,
  DEFAULT_COUNCIL_HUMAN_APPROVAL,
  type AutopilotCouncilOptions,
  type CouncilGate,
  type CouncilState,
  type ProMarker,
} from './types'

const IMPLEMENTER_INSTRUCTION_LIMIT = 2400
const MANUAL_REPLY_LIMIT = 4000
const INVALID_REVIEWER_RAW_LIMIT = 1200
const EMPTY_REFINE_REPAIR_RAW = '{"verdict":"refine","recommended_instruction":""}'
const PERMISSION_RESPONSE: Record<'allow' | 'deny', string> = {
  allow: 'y\r',
  deny: 'n\r',
}

export interface CouncilReviewer {
  start(): Promise<void>
  stop(): void
  review(packetMarkdown: string): Promise<ReviewerSessionResult>
}

export class AutopilotCouncilStateMachine {
  private readonly opts: AutopilotCouncilOptions
  private readonly reviewer: CouncilReviewer
  private readonly watcher: PtyWatcher
  private detachPty: (() => void) | null = null
  private buffer = ''
  private packetSequence = 0
  private repeatedBlockByGate: Partial<Record<CouncilGate, number>> = {}
  private kickoffSent = false
  private stopped = false
  private lifecycleGeneration = 0
  private state: CouncilState

  constructor(opts: AutopilotCouncilOptions, reviewerOverride?: CouncilReviewer) {
    this.opts = opts
    this.reviewer = reviewerOverride ?? new CouncilReviewerSession({
      terminalId: opts.reviewerTerminalId,
      reviewerCli: opts.reviewerCli,
      writeToPty: opts.writeToPty,
      onPtyData: opts.onPtyData,
    })

    const restored = loadCouncilRuntime(opts.projectPath)
    this.state = restored?.state ?? this.createInitialState()
    if (restored) {
      this.packetSequence = restored.internals.packetSequence
      this.repeatedBlockByGate = { ...restored.internals.repeatedBlockByGate }
      this.kickoffSent = restoredRuntimeShowsKickoffSent(this.state)
      this.stopped = this.state.control === 'stopped'
    }

    this.watcher = new PtyWatcher({
      idleMs: 1500,
      onSettle: (snap) => {
        const marker = enrichProMarker(this.buffer, snap.marker as ProMarker)
        const terminalTail = this.buffer || snap.text
        this.buffer = ''
        void this.onSettled(marker, terminalTail)
      },
      onPermissionPrompt: (text) => {
        this.state.permissionRequest = { text: text.slice(0, 200), detectedAt: Date.now() }
        this.block(`permission requested: ${this.state.permissionRequest.text}`)
        this.notify()
      },
      onMissingMarker: () => {
        if (this.state.control !== 'running') return
        this.writeImplementer('Please emit an [ORCH:*] marker with Council-compatible structured fields.')
      },
    })
  }

  getState(): CouncilState {
    return cloneCouncilState(this.state)
  }

  async start(): Promise<void> {
    if (this.state.control === 'running' && this.kickoffSent) return

    const generation = ++this.lifecycleGeneration
    this.stopped = false
    this.state.control = 'running'
    this.state.reviewerStatus = 'starting'
    this.state.validation = discoverValidation(this.opts.projectPath)

    await this.opts.startReviewer()
    if (!this.isGenerationActive(generation)) return

    await this.reviewer.start()
    if (!this.isGenerationActive(generation)) return

    this.state.reviewerStatus = 'idle'

    if (this.detachPty === null) {
      this.detachPty = this.opts.onPtyData(this.opts.terminalId, (data) => {
        if (this.state.control !== 'running') return
        this.buffer += data
        this.watcher.feed(data)
      })
    }

    if (!this.kickoffSent) {
      this.writeImplementer(buildCouncilImplementerPrompt(this.opts.implementerCli))
      this.writeImplementer(stage0Kickoff(this.opts.freeTextIdea))
      this.kickoffSent = true
    }

    if (this.isGenerationActive(generation)) this.notify()
  }

  pause(): void {
    if (this.state.control !== 'running') return
    this.lifecycleGeneration += 1
    this.state.control = 'paused'
    this.state.liveStatus = 'paused'
    this.notify()
  }

  resume(): void {
    if (this.state.control !== 'paused' && this.state.control !== 'blocked') return
    this.lifecycleGeneration += 1
    this.state.control = 'running'
    this.state.escalationReason = null
    this.state.liveStatus = 'running'
    this.notify()
  }

  stop(): void {
    if (this.stopped && this.state.control === 'stopped') return

    this.lifecycleGeneration += 1
    this.state.control = 'stopped'
    this.state.liveStatus = 'stopped'
    this.detachPty?.()
    this.detachPty = null
    this.watcher.reset()
    this.reviewer.stop()
    this.opts.stopReviewer()
    this.stopped = true
    this.notify()
  }

  replyToWaiting(text: string): void {
    const bounded = text.trim().slice(0, MANUAL_REPLY_LIMIT)
    if (!bounded || this.state.control === 'stopped') return

    this.writeImplementer(bounded)
    appendCouncilDecision(this.opts.projectPath, `manual reply: ${bounded.slice(0, 120)}`)
    this.notify()
  }

  respondToPermission(verdict: 'allow' | 'deny'): void {
    if (this.state.permissionRequest === null || this.state.control === 'stopped') return

    this.opts.writeToPty(this.opts.terminalId, PERMISSION_RESPONSE[verdict])
    this.state.permissionRequest = null
    if (this.state.control === 'blocked') {
      this.state.control = 'running'
      this.state.escalationReason = null
    }
    this.notify()
  }

  public async testReviewGate(args: { gate: CouncilGate; marker: ProMarker; terminalTail: string }): Promise<void> {
    await this.runReviewGate(args.gate, args.marker, args.terminalTail)
  }

  private createInitialState(): CouncilState {
    return {
      mode: 'council',
      stage: 'discovery',
      control: 'idle',
      terminalId: this.opts.terminalId,
      reviewerTerminalId: this.opts.reviewerTerminalId,
      implementerCli: this.opts.implementerCli,
      reviewerCli: this.opts.reviewerCli,
      intensity: this.opts.intensity,
      humanApproval: { ...DEFAULT_COUNCIL_HUMAN_APPROVAL, ...(this.opts.humanApproval ?? {}) },
      cycleCount: 0,
      costUsd: 0,
      costCapUsd: this.opts.costCapUsd,
      validation: {},
      recentLog: [],
      liveStatus: null,
      escalationReason: null,
      lastMarker: null,
      lastCouncilDecision: null,
      lastReviewPacketId: null,
      reviewerStatus: 'idle',
      reviewerWarning: null,
      permissionRequest: null,
    }
  }

  private async onSettled(marker: ProMarker, terminalTail: string): Promise<void> {
    this.state.lastMarker = {
      kind: marker.kind,
      ...(marker.subgoalId === undefined ? {} : { subgoalId: marker.subgoalId }),
      ...(marker.status === undefined ? {} : { status: marker.status }),
      receivedAt: Date.now(),
    }

    const gate = this.gateForMarker(marker)
    if (gate === null) {
      this.writeImplementer('Proceed. Council review is not required for this gate.')
      this.notify()
      return
    }

    await this.runReviewGate(gate, marker, terminalTail)
  }

  private gateForMarker(marker: ProMarker): CouncilGate | null {
    const artifactPath = normalizePath(marker.artifactPath ?? '')

    if (marker.shape === 'approve' && artifactPath.endsWith('spec.md')) return this.hasGate('spec') ? 'spec' : null
    if (marker.shape === 'approve' && artifactPath.endsWith('plan.md')) return this.hasGate('plan') ? 'plan' : null
    if (marker.shape === 'approve' && artifactPath.includes('/reviews/')) return this.hasGate('phase') ? 'phase' : null
    if (marker.shape === 'approve' && artifactPath.endsWith('final-review.md')) return this.hasGate('final') ? 'final' : null
    if (marker.shape === 'decide-with-rationale') return this.hasGate('architecture') ? 'architecture' : null
    if (marker.kind === 'STUCK') return this.hasGate('stuck') ? 'stuck' : null
    if (marker.kind === 'PROGRESS' && marker.status === 'done') return this.hasGate('task') ? 'task' : null
    if (marker.shape === 'transition') return this.hasGate('final') ? 'final' : null

    return null
  }

  private hasGate(gate: CouncilGate): boolean {
    return COUNCIL_GATES_BY_INTENSITY[this.state.intensity].includes(gate)
  }

  private async runReviewGate(gate: CouncilGate, marker: ProMarker, terminalTail: string): Promise<void> {
    const generation = this.lifecycleGeneration
    const controlAtStart = this.state.control
    const sequence = this.packetSequence + 1
    this.state.reviewerStatus = 'reviewing'
    this.state.reviewerWarning = null
    this.state.liveStatus = `reviewing ${gate}`
    this.notify()

    const artifactContent = marker.artifactPath ? this.readArtifactForMarker(marker.artifactPath) : null
    const packet = buildReviewPacket({
      sequence,
      gate,
      stage: this.state.stage,
      projectPath: this.opts.projectPath,
      goalSummary: this.opts.freeTextIdea,
      implementerCli: this.opts.implementerCli,
      reviewerCli: this.opts.reviewerCli,
      marker,
      artifactPath: marker.artifactPath ?? null,
      artifactContent,
      diffSummary: null,
      filesChanged: marker.filesChanged ?? [],
      testEvidence: marker.tests ?? null,
      recentDecisions: readRecentCouncilDecisions(this.opts.projectPath),
      terminalTail,
    })
    const packetMarkdown = formatReviewPacketForReviewer(packet)
    const reviewResult = await this.reviewWithProtocolRepairs(packetMarkdown, gate, generation, controlAtStart)
    if (!this.isReviewGenerationActive(generation, controlAtStart)) return

    this.packetSequence = sequence
    this.state.lastReviewPacketId = packet.id

    if (reviewResult.kind !== 'decision') {
      this.handleReviewerFailure(gate, packet.id, packetMarkdown, reviewResult)
      return
    }

    writeReviewPacketFiles(this.opts.projectPath, packet.id, packetMarkdown, JSON.stringify(reviewResult.decision, null, 2))

    const repeated = this.repeatedBlockByGate[gate] ?? 0
    const arbitration = arbitrateCouncilReview({ gate, review: reviewResult.decision, repeatedBlockCount: repeated })

    if (arbitration.action === 'retry-reviewer') {
      this.repeatedBlockByGate[gate] = repeated + 1
      this.handleReviewerProtocolFallback(gate, packet.id, packetMarkdown, EMPTY_REFINE_REPAIR_RAW, 'empty-refine-instruction')
      return
    }

    this.state.lastCouncilDecision = arbitration
    this.state.reviewerStatus = 'idle'
    this.state.reviewerWarning = null
    this.state.liveStatus = `reviewed ${gate}: ${arbitration.action}`
    appendCouncilDecision(this.opts.projectPath, `${gate}: ${arbitration.action} (${arbitration.reason})`)

    if (arbitration.action === 'instruct-implementer') {
      this.repeatedBlockByGate[gate] = repeated + 1
      this.writeImplementer(`Council Reviewer refinement: ${trimInstruction(arbitration.instruction)}`)
    } else if (arbitration.action === 'ask-user') {
      this.block(describeEscalation(arbitration.reason, reviewResult.decision.rationale))
    } else {
      this.repeatedBlockByGate[gate] = 0
      this.writeImplementer(`Council decision: ${arbitration.action}. Proceed.`)
    }

    this.notify()
  }

  private async reviewWithProtocolRepairs(
    packetMarkdown: string,
    gate: CouncilGate,
    generation: number,
    controlAtStart: CouncilState['control'],
  ): Promise<ReviewerSessionResult> {
    const firstResult = await this.reviewWithInvalidRepair(packetMarkdown, generation, controlAtStart)
    if (!this.isReviewGenerationActive(generation, controlAtStart) || firstResult.kind !== 'decision') return firstResult

    const repeated = this.repeatedBlockByGate[gate] ?? 0
    const arbitration = arbitrateCouncilReview({ gate, review: firstResult.decision, repeatedBlockCount: repeated })
    if (arbitration.action !== 'retry-reviewer') return firstResult

    this.state.reviewerStatus = 'reviewing'
    this.state.reviewerWarning = arbitration.reason
    this.state.liveStatus = 'reviewer refine instruction empty; retrying once'
    this.notify()
    if (!this.isReviewGenerationActive(generation, controlAtStart)) return firstResult

    return this.reviewer.review(buildEmptyRefineRepairPacket(packetMarkdown, arbitration.reason))
  }

  private async reviewWithInvalidRepair(
    packetMarkdown: string,
    generation: number,
    controlAtStart: CouncilState['control'],
  ): Promise<ReviewerSessionResult> {
    const firstResult = await this.reviewer.review(packetMarkdown)
    if (!this.isReviewGenerationActive(generation, controlAtStart) || firstResult.kind !== 'invalid') return firstResult

    this.state.reviewerStatus = 'protocol-violation'
    this.state.reviewerWarning = firstResult.error
    this.state.liveStatus = 'reviewer response invalid; retrying once'
    this.notify()
    if (!this.isReviewGenerationActive(generation, controlAtStart)) return firstResult

    return this.reviewer.review(buildInvalidReviewerRepairPacket(packetMarkdown, firstResult))
  }

  private handleReviewerFailure(
    gate: CouncilGate,
    packetId: string,
    packetMarkdown: string,
    reviewResult: Exclude<ReviewerSessionResult, { kind: 'decision' }>,
  ): void {
    const reviewerVerdict = reviewResult.kind === 'timeout' ? 'timeout' : 'invalid'
    this.state.reviewerStatus = reviewResult.kind === 'timeout' ? 'timed-out' : 'protocol-violation'
    this.state.reviewerWarning = reviewResult.kind === 'invalid' ? reviewResult.error : reviewResult.kind
    this.applyReviewerFailure(
      gate,
      packetId,
      packetMarkdown,
      reviewResult.raw,
      reviewerVerdict,
      reviewResult.kind === 'invalid' ? reviewResult.error : reviewResult.kind,
    )
  }

  private handleReviewerProtocolFallback(
    gate: CouncilGate,
    packetId: string,
    packetMarkdown: string,
    raw: string,
    reason: string,
  ): void {
    this.state.reviewerStatus = 'protocol-violation'
    this.state.reviewerWarning = reason
    this.applyReviewerFailure(gate, packetId, packetMarkdown, raw, 'invalid', reason)
  }

  private applyReviewerFailure(
    gate: CouncilGate,
    packetId: string,
    packetMarkdown: string,
    responseRaw: string,
    reviewerVerdict: 'timeout' | 'invalid',
    reason: string,
  ): void {
    writeReviewPacketFiles(this.opts.projectPath, packetId, packetMarkdown, responseRaw)

    const action = gate === 'spec' || gate === 'plan' || gate === 'final' ? 'ask-user' : 'ignore-reviewer'
    this.state.lastCouncilDecision = {
      action,
      gate,
      risk: 'medium',
      instruction: '',
      reason,
      reviewerVerdict,
    }
    appendCouncilDecision(this.opts.projectPath, `${gate}: ${action} (${reviewerVerdict})`)

    if (action === 'ask-user') {
      this.block(`Reviewer ${reviewerVerdict} at ${gate} gate.`)
    } else {
      this.writeImplementer(`Reviewer ${reviewerVerdict}; proceed with Implementer plan.`)
    }

    this.notify()
  }

  private readArtifactForMarker(path: string): string | null {
    if (!isSafeRelativeArtifactPath(path)) return null

    const candidates = [
      resolveContained(this.opts.projectPath, path),
      resolveContained(join(this.opts.projectPath, '.autopilot-pro'), path),
      resolveContained(join(this.opts.projectPath, '.autopilot-council'), path),
    ].filter((candidate): candidate is string => candidate !== null)
    const hit = candidates.find((candidate) => existsSync(candidate))
    return hit ? readFileSync(hit, 'utf-8') : null
  }

  private isGenerationActive(generation: number): boolean {
    return this.lifecycleGeneration === generation && this.state.control !== 'stopped' && this.state.control !== 'paused'
  }

  private isReviewGenerationActive(generation: number, controlAtStart: CouncilState['control']): boolean {
    return (
      this.lifecycleGeneration === generation &&
      this.state.control !== 'stopped' &&
      (this.state.control !== 'paused' || controlAtStart === 'paused')
    )
  }

  private block(reason: string): void {
    this.state.control = 'blocked'
    this.state.escalationReason = reason
    this.state.liveStatus = reason
  }

  private writeImplementer(text: string): void {
    this.opts.writeToPty(this.opts.terminalId, text.endsWith('\r') ? text : `${text}\r`)
  }

  private notify(): void {
    saveCouncilRuntime(this.opts.projectPath, this.state, {
      packetSequence: this.packetSequence,
      repeatedBlockByGate: this.repeatedBlockByGate,
    })
    this.opts.onUpdate(cloneCouncilState(this.state))
  }
}

function normalizePath(path: string): string {
  return normalize(path).replace(/\\/g, '/')
}

function trimInstruction(instruction: string): string {
  const trimmed = instruction.trim()
  if (trimmed.length <= IMPLEMENTER_INSTRUCTION_LIMIT) return trimmed
  return `${trimmed.slice(0, IMPLEMENTER_INSTRUCTION_LIMIT)}\n[trimmed ${trimmed.length - IMPLEMENTER_INSTRUCTION_LIMIT} chars]`
}

function describeEscalation(reason: string, rationale: string): string {
  const trimmedRationale = rationale.trim()
  return trimmedRationale ? `${reason}: ${trimmedRationale}` : reason
}

function cloneCouncilState(state: CouncilState): CouncilState {
  return JSON.parse(JSON.stringify(state)) as CouncilState
}

function restoredRuntimeShowsKickoffSent(state: CouncilState): boolean {
  return state.lastMarker !== null || state.lastReviewPacketId !== null || state.recentLog.length > 0
}

function isSafeRelativeArtifactPath(path: string): boolean {
  if (path.trim().length === 0 || isAbsolute(path)) return false
  return !normalize(path).split(/[\\/]+/).includes('..')
}

function resolveContained(root: string, path: string): string | null {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, path)
  const relativePath = relative(resolvedRoot, resolvedPath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return resolvedPath
}

function buildInvalidReviewerRepairPacket(
  packetMarkdown: string,
  invalidResult: Extract<ReviewerSessionResult, { kind: 'invalid' }>,
): string {
  return [
    'The prior Reviewer response was invalid for this same bounded Council review.',
    `Protocol error: ${invalidResult.error}`,
    '',
    'Return valid framed JSON for the same bounded review. Do not use markdown fences.',
    'Keep the same schema: verdict, risk, findings, recommended_instruction, and rationale.',
    '',
    'Prior invalid response excerpt:',
    invalidResult.raw.slice(0, INVALID_REVIEWER_RAW_LIMIT) || '(empty)',
    '',
    packetMarkdown,
  ].join('\n')
}

function buildEmptyRefineRepairPacket(packetMarkdown: string, reason: string): string {
  return [
    'The prior Reviewer decision requested refine but did not include a concrete instruction.',
    `Protocol issue: ${reason}`,
    '',
    'Review the same bounded packet again and return valid framed JSON.',
    'If refinement is still needed, recommended_instruction must be specific and actionable.',
    'If no concrete refinement is needed, return verdict "approve".',
    '',
    packetMarkdown,
  ].join('\n')
}
