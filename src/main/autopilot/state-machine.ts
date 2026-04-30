import type {
  ApiClient, ActivityEntry, AutopilotOptions, AutopilotState, DecideResult,
  Goal, Milestone, SettledSnapshot, AutopilotPhase,
} from './types'
import { PtyWatcher } from './pty-watcher'
import { CostTracker } from './cost-tracker'
import { readGoal, readMilestones, writeMilestone, appendLog, autopilotDirExists } from './state-files'
import { decide } from './decision'
import { runResetSequence } from './reset'
import { makeApiClient } from './api-client'
import { DOER_SYSTEM_PROMPT, buildWizardKickoff } from './prompts'

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

  constructor(opts: AutopilotOptions, apiOverride?: ApiClient, ptyIdleMs = 1500) {
    this.opts = opts
    this.api = apiOverride ?? makeApiClient(opts.apiProvider, opts.apiKey, opts.plannerModel)
    this.cost = new CostTracker(opts.projectPath, opts.costCapUsd, (pct) => {
      if (pct === 100) this.transition('paused', 'cost cap reached')
    })

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
    }
    this.state.currentMilestoneId = this.findCurrentMilestoneId()

    this.watcher = new PtyWatcher({
      idleMs: ptyIdleMs,
      onSettle: (snap) => this.onSettled(snap),
    })
  }

  async start(): Promise<void> {
    this.detachPty = this.opts.onPtyData(this.opts.terminalId, (data) => {
      this.outputVolumeSinceReset += data.length
      this.watcher.feed(data)
    })

    this.opts.writeToPty(this.opts.terminalId, DOER_SYSTEM_PROMPT + '\r')

    if (autopilotDirExists(this.opts.projectPath) && this.state.goal && this.state.milestones.length > 0) {
      this.transition('executing', 'goal already defined; resuming')
    } else {
      this.opts.writeToPty(this.opts.terminalId, buildWizardKickoff(this.opts.freeTextIdea) + '\r')
      this.transition('wizard', 'wizard kickoff sent')
    }
  }

  pause(reason = 'user pause'): void { this.transition('paused', reason) }
  resume(): void {
    if (this.state.phase !== 'paused') return
    if (this.state.goal && this.state.milestones.length > 0) {
      this.transition('executing', 'resumed')
    } else {
      this.transition('wizard', 'resumed')
    }
  }
  stop(): void {
    if (this.detachPty) { this.detachPty(); this.detachPty = null }
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
    this.appendActivity('orchestrator-reply', `Manual reply: ${text.slice(0, 80)}`)
  }

  private async onSettled(snap: SettledSnapshot): Promise<void> {
    while (this.settleResolvers.length) this.settleResolvers.shift()?.()

    this.appendActivity('doer-marker', `${snap.marker.kind}${snap.marker.subgoalId ? ` ${snap.marker.subgoalId} ${snap.marker.status}` : ''}`)

    if (snap.marker.kind === 'PROGRESS') {
      this.applyProgress(snap.marker.subgoalId ?? '', snap.marker.status ?? 'done')
    }

    if (snap.marker.kind === 'STUCK') {
      this.state.escalationReason = snap.marker.text
      this.transition('escalated', `STUCK: ${snap.marker.text}`)
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
      await this.reset('three consecutive partial markers — likely confusion')
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

    let out
    try {
      out = await decide(this.api, {
        goal: this.state.goal,
        milestones: this.state.milestones,
        currentMilestoneId: this.state.currentMilestoneId,
        lastSnapshot: snap,
        recentLogTail: this.state.recentLog.slice(-5),
        validation: this.state.validation,           // NEW
        learnings: [],                                // populated in Task 11
        steering: { tech: null, structure: null },   // populated in Task 11
      })
    } catch (e: any) {
      this.appendActivity('escalation', `API error: ${e?.message ?? 'unknown'}`)
      this.transition('escalated', `API error: ${e?.message ?? 'unknown'}`)
      return
    }

    this.cost.add(out.costUsd)
    this.state.costUsd = this.cost.totalUsd

    if (this.cost.isOverCap()) {
      this.transition('paused', 'cost cap reached')
      return
    }

    this.handleDecision(out.result)
    this.notify()
  }

  private handleDecision(d: DecideResult): void {
    switch (d.kind) {
      case 'reply':
        this.opts.writeToPty(this.opts.terminalId, d.text + '\r')
        this.state.lastDecisionText = `Replied: ${d.text.slice(0, 80)}`
        this.appendActivity('orchestrator-reply', d.text.slice(0, 100))
        return
      case 'reset':
        void this.reset('orchestrator decided to reset')
        return
      case 'done':
        this.transition('completed', `done: ${d.evidence}`)
        return
      case 'escalate':
        this.transition('escalated', d.reason)
        return
    }
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
    this.appendActivity(phase === 'paused' ? 'orchestrator-pause' : phase === 'escalated' ? 'escalation' : 'orchestrator-resume', `→ ${phase}: ${reason}`)
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
  }

  // For tests
  feedPty(data: string): void { this.watcher.feed(data) }
}
