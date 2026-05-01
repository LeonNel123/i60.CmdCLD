import type {
  ApiClient, ActivityEntry, AutopilotOptions, AutopilotState, DecideResult,
  Goal, Milestone, SettledSnapshot, AutopilotPhase,
} from './types'
import { PtyWatcher } from './pty-watcher'
import { CostTracker } from './cost-tracker'
import { readGoal, readMilestones, writeMilestone, appendLog, appendTranscript, autopilotDirExists, readLearnings, readSteering } from './state-files'
import { discoverValidation } from './validation'
import { decide } from './decision'
import { runResetSequence } from './reset'
import { makeApiClient } from './api-client'
import { DOER_SYSTEM_PROMPT, buildWizardKickoff } from './prompts'
import { debugCall } from './debug'
import { saveRuntimeClassic, loadRuntimeClassic } from './runtime-state'

export class AutopilotStateMachine {
  state: AutopilotState
  private opts: AutopilotOptions
  private api: ApiClient
  private cost: CostTracker
  private watcher: PtyWatcher
  private detachPty: (() => void) | null = null
  private settleResolvers: Array<() => void> = []
  private outputVolumeSinceReset = 0
  private partialStreak = 0
  private markerFallbackPromptCount = 0
  // Long-silence escalate: if no PTY bytes arrive for this long while we're
  // executing or in wizard phase, escalate. Catches truly-hung doer / dead
  // subagent / network stalls. 30 minutes is generous enough for legitimate
  // long-running subagent work; bump for projects that genuinely run longer.
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private maxSilenceMs: number
  private runtimeJsonEnabled: boolean

  constructor(opts: AutopilotOptions, apiOverride?: ApiClient, ptyIdleMs = 1500, maxSilenceMs = 30 * 60 * 1000) {
    this.opts = opts
    this.api = apiOverride ?? makeApiClient(opts.apiProvider, opts.apiKey, opts.plannerModel)
    this.cost = new CostTracker(opts.projectPath, opts.costCapUsd, (pct) => {
      if (pct === 100) this.transition('paused', 'cost cap reached')
    })
    this.maxSilenceMs = maxSilenceMs
    this.runtimeJsonEnabled = opts.runtimeJson !== false

    this.state = {
      phase: 'idle',
      goal: readGoal(opts.projectPath),
      milestones: readMilestones(opts.projectPath),
      currentMilestoneId: null,
      cycleCount: 0,
      costUsd: this.cost.totalUsd,
      costCapUsd: this.cost.capUsd,
      lastDecisionText: '',
      recentLog: [],
      escalationReason: null,
      validation: {},
      liveStatus: null,
      lastMarker: null,
      permissionRequest: null,
    }
    this.state.currentMilestoneId = this.findCurrentMilestoneId()

    this.watcher = new PtyWatcher({
      idleMs: ptyIdleMs,
      onSettle: (snap) => this.onSettled(snap),
      onForceSettleArmed: (firesAt) => {
        const seconds = ((firesAt - Date.now()) / 1000).toFixed(1)
        this.state.liveStatus = `force-settle armed (${seconds}s)`
        this.notify()
      },
      onForceSettleCanceled: () => {
        this.state.liveStatus = 'waiting for doer'
        this.notify()
      },
      onPermissionPrompt: (text) => {
        this.state.permissionRequest = { text: text.slice(0, 200), detectedAt: Date.now() }
        this.appendActivity('escalation', 'permission requested')
        this.notify()
      },
      onMissingMarker: () => {
        this.handleMissingMarker()
      },
    })
  }

  async start(): Promise<void> {
    this.markerFallbackPromptCount = 0

    // Restore runtime state from disk if present and valid (must come after
    // field resets above so restored values take precedence)
    if (this.runtimeJsonEnabled) {
      const rt = loadRuntimeClassic(this.opts.projectPath, this.state.milestones)
      if (rt) {
        this.state.phase = rt.phase
        this.state.currentMilestoneId = rt.currentMilestoneId
        this.state.cycleCount = rt.cycleCount
        this.state.costUsd = rt.costUsd
        this.markerFallbackPromptCount = rt.markerFallbackPromptCount
        this.partialStreak = rt.partialStreak
        this.outputVolumeSinceReset = rt.outputVolumeSinceReset
        this.appendActivity('orchestrator-resume', `restored from runtime.json (cycle ${rt.cycleCount})`)
      }
    }

    this.detachPty = this.opts.onPtyData(this.opts.terminalId, (data) => {
      this.outputVolumeSinceReset += data.length
      this.armSilenceTimer()
      this.watcher.feed(data)
    })

    // Discover validation once at start
    this.state.validation = discoverValidation(this.opts.projectPath)

    this.opts.writeToPty(this.opts.terminalId, DOER_SYSTEM_PROMPT + '\r')

    if (autopilotDirExists(this.opts.projectPath) && this.state.goal && this.state.milestones.length > 0) {
      this.transition('executing', 'goal already defined; resuming')
    } else {
      this.opts.writeToPty(this.opts.terminalId, buildWizardKickoff(this.opts.freeTextIdea) + '\r')
      this.transition('wizard', 'wizard kickoff sent')
    }
    this.state.liveStatus = 'waiting for doer'
    this.notify()

    this.armSilenceTimer()
  }

  pause(reason = 'user pause'): void {
    this.clearSilenceTimer()
    this.state.liveStatus = null
    this.transition('paused', reason)
  }
  resume(): void {
    if (this.state.phase !== 'paused') return
    if (this.state.goal && this.state.milestones.length > 0) {
      this.transition('executing', 'resumed')
    } else {
      this.transition('wizard', 'resumed')
    }
    this.state.liveStatus = 'waiting for doer'
    this.armSilenceTimer()
    this.notify()
  }
  stop(): void {
    if (this.detachPty) { this.detachPty(); this.detachPty = null }
    this.clearSilenceTimer()
    this.state.liveStatus = null
    this.transition('stopped', 'user stopped')
  }
  approveGoal(): void {
    this.state.goal = readGoal(this.opts.projectPath)
    this.state.milestones = readMilestones(this.opts.projectPath)
    this.state.currentMilestoneId = this.findCurrentMilestoneId()
    if (!this.state.goal || this.state.milestones.length === 0) {
      this.transition('escalated', 'goal files missing or empty after wizard')
      return
    }
    this.transition('executing', 'goal approved')
  }
  replyToWaiting(text: string): void {
    this.opts.writeToPty(this.opts.terminalId, text + '\r')
    this.state.liveStatus = 'waiting for doer'
    this.appendActivity('orchestrator-reply', `Manual reply: ${text.slice(0, 80)}`)
    this.recordUserManualTranscript(text)
    this.notify()
  }

  private async onSettled(snap: SettledSnapshot): Promise<void> {
    while (this.settleResolvers.length) this.settleResolvers.shift()?.()

    this.markerFallbackPromptCount = 0

    this.state.lastMarker = {
      kind: snap.marker.kind,
      subgoalId: snap.marker.subgoalId,
      status: snap.marker.status,
      receivedAt: snap.receivedAt,
    }

    this.appendActivity('doer-marker', `${snap.marker.kind}${snap.marker.subgoalId ? ` ${snap.marker.subgoalId} ${snap.marker.status}` : ''}`)

    if (snap.marker.kind === 'PROGRESS') {
      this.applyProgress(snap.marker.subgoalId ?? '', snap.marker.status ?? 'done')
    }

    if (snap.marker.kind === 'STUCK') {
      await this.tryDebugThenEscalate(snap, 'stuck')
      return
    }

    if (snap.marker.kind === 'GOAL_READY') {
      this.state.goal = readGoal(this.opts.projectPath)
      this.state.milestones = readMilestones(this.opts.projectPath)
      this.state.currentMilestoneId = this.findCurrentMilestoneId()
      this.transition('awaiting_goal_review', 'wizard produced goal files')
      return
    }

    if (this.state.phase !== 'executing' && this.state.phase !== 'wizard') return

    if (this.cost.isOverCap()) {
      this.transition('paused', 'cost cap reached')
      return
    }

    if (this.partialStreak >= 3) {
      this.partialStreak = 0
      await this.tryDebugThenEscalate(snap, 'partial-streak')
      return
    }

    if (this.outputVolumeSinceReset >= (this.state.goal?.constraints.maxDoerOutputPerReset ?? 60000)) {
      await this.reset('output volume threshold reached')
      return
    }

    if (snap.marker.kind === 'WAITING') {
      await this.cycleDecide(snap)
    }
  }

  private async cycleDecide(snap: SettledSnapshot): Promise<void> {
    if (!this.state.goal) {
      this.opts.writeToPty(this.opts.terminalId, 'Continue.\r')
      this.appendActivity('orchestrator-reply', 'Continue. (wizard default)')
      return
    }

    this.state.cycleCount++
    if (this.state.cycleCount > (this.state.goal.constraints.maxIterations ?? 40)) {
      this.transition('paused', `max iterations (${this.state.goal.constraints.maxIterations}) reached`)
      return
    }

    const learnings = readLearnings(this.opts.projectPath)
    const steering = readSteering(this.opts.projectPath)
    this.state.liveStatus = 'calling planner'
    this.notify()
    let out
    try {
      out = await decide(this.api, {
        goal: this.state.goal,
        milestones: this.state.milestones,
        currentMilestoneId: this.state.currentMilestoneId,
        lastSnapshot: snap,
        recentLogTail: this.state.recentLog.slice(-5),
        validation: this.state.validation,
        learnings,
        steering,
      })
    } catch (e: any) {
      this.appendActivity('escalation', `API error: ${e?.message ?? 'unknown'}`)
      this.transition('escalated', `API error: ${e?.message ?? 'unknown'}`)
      return
    } finally {
      this.state.liveStatus = 'waiting for doer'
      this.notify()
    }

    this.cost.add(out.costUsd)
    this.state.costUsd = this.cost.totalUsd

    if (this.cost.isOverCap()) {
      this.transition('paused', 'cost cap reached')
      return
    }

    this.handleDecision(out.result, snap)
    this.notify()
  }

  private handleDecision(d: DecideResult, snap?: SettledSnapshot): void {
    switch (d.kind) {
      case 'reply':
        this.opts.writeToPty(this.opts.terminalId, d.text + '\r')
        this.state.lastDecisionText = `Replied: ${d.text.slice(0, 80)}`
        this.appendActivity('orchestrator-reply', d.text.slice(0, 100))
        if (snap) this.recordTranscript(snap, 'reply', d.text)
        return
      case 'reset':
        if (snap) this.recordTranscript(snap, 'reset', 'orchestrator decided to reset')
        void this.reset('orchestrator decided to reset')
        return
      case 'done':
        if (snap) this.recordTranscript(snap, 'done', d.evidence)
        this.transition('completed', `done: ${d.evidence}`)
        return
      case 'escalate':
        if (snap) this.recordTranscript(snap, 'escalate', d.reason)
        this.transition('escalated', d.reason)
        return
    }
  }

  /**
   * Append one verbatim block to .autopilot/transcript.md per orchestrator action.
   * The log.md timeline is terse (truncated); transcript captures the full Q + A.
   */
  private recordTranscript(
    snap: SettledSnapshot,
    action: 'reply' | 'reset' | 'done' | 'escalate' | 'debug-retry' | 'user-manual',
    body: string,
  ): void {
    const ts = new Date().toISOString()
    const cycle = this.state.cycleCount
    const m = snap.marker
    const doerQuestion = (m.question || m.text || '').trim()
    const subId = m.subgoalId ? ` ${m.subgoalId} ${m.status ?? ''}`.trimEnd() : ''
    const cost = `$${this.state.costUsd.toFixed(4)}`
    const model = this.opts.plannerModel

    const lines: string[] = []
    lines.push(`## ${ts} — Cycle ${cycle} — ${action}`)
    lines.push('')
    lines.push(`**Doer (${m.kind}${subId}):**`)
    lines.push('')
    lines.push(doerQuestion ? `> ${doerQuestion.replace(/\n/g, '\n> ')}` : '> (no question text)')
    lines.push('')
    lines.push(`**Orchestrator → ${action}** (model: ${model}, cost so far: ${cost})`)
    lines.push('')
    lines.push(body ? `> ${body.replace(/\n/g, '\n> ')}` : '> (no body)')
    lines.push('')
    lines.push('---')
    lines.push('')
    appendTranscript(this.opts.projectPath, lines.join('\n'))
  }

  private recordUserManualTranscript(text: string): void {
    const ts = new Date().toISOString()
    const cost = `$${this.state.costUsd.toFixed(4)}`
    const lines = [
      `## ${ts} — User manual reply`,
      '',
      `**User typed** (cost so far: ${cost})`,
      '',
      text ? `> ${text.replace(/\n/g, '\n> ')}` : '> (empty)',
      '',
      '---',
      '',
    ]
    appendTranscript(this.opts.projectPath, lines.join('\n'))
  }

  private async tryDebugThenEscalate(
    snap: SettledSnapshot,
    trigger: 'stuck' | 'partial-streak',
  ): Promise<void> {
    if (!this.state.goal) {
      this.transition('escalated', `${trigger}: no goal`)
      return
    }
    this.state.liveStatus = 'calling planner'
    this.notify()
    let out
    try {
      out = await debugCall(this.api, {
        goal: this.state.goal,
        currentMilestoneId: this.state.currentMilestoneId,
        lastSnapshot: snap,
        trigger,
      })
    } finally {
      this.state.liveStatus = 'waiting for doer'
      this.notify()
    }
    this.cost.add(out.costUsd)
    this.state.costUsd = this.cost.totalUsd

    if (out.result.kind === 'retry') {
      this.opts.writeToPty(this.opts.terminalId, out.result.instruction + '\r')
      this.state.lastDecisionText = `Debug retry: ${out.result.instruction.slice(0, 80)}`
      this.appendActivity('orchestrator-reply', `debug retry: ${out.result.instruction.slice(0, 100)}`)
      this.recordTranscript(snap, 'debug-retry', out.result.instruction)
      this.notify()
      return
    }
    // block or human → escalate with the reason
    const reason = out.result.kind === 'block'
      ? `block: ${out.result.reason}`
      : `human: ${out.result.reason}`
    this.recordTranscript(snap, 'escalate', `${trigger} → ${reason}`)
    this.state.escalationReason = reason
    this.transition('escalated', `${trigger} → ${reason}`)
  }

  private async reset(reason: string): Promise<void> {
    this.appendActivity('orchestrator-reset', reason)
    await runResetSequence({
      writeToPty: (s) => this.opts.writeToPty(this.opts.terminalId, s),
      waitForSettle: () => new Promise<void>((res) => { this.settleResolvers.push(res) }),
      currentMilestoneId: this.state.currentMilestoneId,
    })
    this.outputVolumeSinceReset = 0
  }

  private applyProgress(subgoalIdRaw: string, status: 'done' | 'partial' | 'blocked'): void {
    const [mId, sId] = subgoalIdRaw.split('/')
    const m = this.state.milestones.find((mm) => mm.id === mId)
    if (!m) return
    const s = m.subgoals.find((ss) => ss.id === sId)
    if (!s) return
    s.status = status
    if (status === 'partial') this.partialStreak++
    else this.partialStreak = 0
    if (status === 'done' && m.subgoals.every((ss) => ss.status === 'done')) {
      m.status = 'done'
      void this.reset(`milestone ${m.id} complete`)
    }
    writeMilestone(this.opts.projectPath, m)
    this.state.currentMilestoneId = this.findCurrentMilestoneId()
  }

  private findCurrentMilestoneId(): string | null {
    const inProgress = this.state.milestones.find((m) => m.status === 'in-progress')
    if (inProgress) return inProgress.id
    const next = this.state.milestones.find((m) => m.status !== 'done')
    return next?.id ?? null
  }

  private transition(phase: AutopilotPhase, reason: string): void {
    this.state.phase = phase
    this.markerFallbackPromptCount = 0
    // Stop the silence timer when we've reached a non-running phase. start() /
    // resume() re-arm it. pause() / stop() clear it directly already, but
    // belt-and-braces: any transition into a non-active phase clears here too.
    if (phase === 'escalated' || phase === 'completed' || phase === 'stopped' || phase === 'paused') {
      this.clearSilenceTimer()
    }
    this.appendActivity(phase === 'paused' ? 'orchestrator-pause' : phase === 'escalated' ? 'escalation' : 'orchestrator-resume', `→ ${phase}: ${reason}`)
    this.notify()
  }

  private handleMissingMarker(): void {
    if (this.markerFallbackPromptCount >= 2) {
      this.state.escalationReason = 'doer not emitting markers — manual intervention needed'
      this.appendActivity('escalation', this.state.escalationReason)
      this.notify()
      return
    }
    this.markerFallbackPromptCount++
    const nudge = `I see output but no marker. Please emit [ORCH:WAITING] (with your question), [ORCH:PROGRESS] <id> done|partial|blocked, [ORCH:GOAL_READY], or [ORCH:STUCK] (with the blocker) so the orchestrator knows where you are.`
    this.opts.writeToPty(this.opts.terminalId, nudge + '\r')
    this.appendActivity('orchestrator-reply', `marker fallback nudge (${this.markerFallbackPromptCount}/2)`)
    this.notify()
  }

  respondToPermission(verdict: 'allow' | 'deny'): void {
    if (!this.state.permissionRequest) return
    const reply = verdict === 'allow' ? '1\r' : '3\r'
    this.opts.writeToPty(this.opts.terminalId, reply)
    this.state.permissionRequest = null
    this.appendActivity('orchestrator-reply', `permission ${verdict}`)
    this.notify()
  }

  private appendActivity(kind: ActivityEntry['kind'], summary: string): void {
    const e: ActivityEntry = { at: Date.now(), kind, summary }
    this.state.recentLog.push(e)
    if (this.state.recentLog.length > 10) this.state.recentLog.shift()
    appendLog(this.opts.projectPath, e)
  }

  private notify(): void {
    try { this.opts.onUpdate(this.state) } catch { /* best effort */ }
    if (this.runtimeJsonEnabled) {
      saveRuntimeClassic(this.opts.projectPath, this.state, {
        markerFallbackPromptCount: this.markerFallbackPromptCount,
        partialStreak: this.partialStreak,
        outputVolumeSinceReset: this.outputVolumeSinceReset,
      })
    }
  }

  // ---- silence timer (escalates if doer goes truly silent for too long) ----

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = setTimeout(() => this.onSilenceExceeded(), this.maxSilenceMs)
    // Don't keep the Node event loop alive solely for this timer — it's an
    // observability backstop, not a critical path.
    if (typeof (this.silenceTimer as any)?.unref === 'function') {
      (this.silenceTimer as any).unref()
    }
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  private onSilenceExceeded(): void {
    if (this.state.phase !== 'executing' && this.state.phase !== 'wizard') return
    const minutes = Math.round(this.maxSilenceMs / 60000)
    this.state.escalationReason = `doer silent for ${minutes}+ minutes`
    this.transition('escalated', `silence: doer produced no output for ${minutes}+ minutes`)
  }

  // For tests — mirrors the production onPtyData listener (volume + silence + watcher feed)
  feedPty(data: string): void {
    this.outputVolumeSinceReset += data.length
    this.armSilenceTimer()
    this.watcher.feed(data)
  }
}
