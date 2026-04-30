// Top-level state machine for Autopilot PRO.
//
// Drives the five stages (discovery → planning → implementation → phase-review →
// final-review) gated on artifact approval state. Reuses the classic PtyWatcher,
// CostTracker, and silence-guard timer pattern from src/main/autopilot.
//
// Wave 3.0 ships full Stages 0/1/2 + transitions; Stages 3 and 4 are
// skeletal — they signal completion via a meta-reflect call but don't yet
// run a code-review pipeline. Wave 3.1+ fills those in.

import type { ApiClient, ActivityEntry } from '../autopilot/types'
import type {
  AutopilotProOptions, ProState, ProStage, ProMarker, ProSettledSnapshot,
  ProDecideResult, ArtifactKind,
} from './types'
import { PRO_DIR } from './types'
import { PtyWatcher, findLastMarker } from '../autopilot/pty-watcher'
import { CostTracker } from '../autopilot/cost-tracker'
import { discoverValidation } from '../autopilot/validation'
import { makeApiClient } from '../autopilot/api-client'
import { decidePro, applyPrinciplesToApprove } from './decision'
import {
  readArtifact, writeArtifact, markApproved, markUnapproved,
  incrementRefineCount, readState, writeState, reconcile,
} from './artifacts'
import { parsePhases, currentPhase, phaseDoneFromTasks } from './phases'
import { DOER_SYSTEM_PROMPT_PRO, stage3Kickoff, stage4Kickoff } from './prompts'
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

const REFINE_LIMIT = 3
const DEFAULT_MAX_SILENCE_MS = 30 * 60 * 1000

// ----- Marker → ProMarker enrichment -----
//
// The classic findLastMarker returns DoerMarker with structured fields. PRO
// adds shape/options/artifactPath/assumption/delta/subagentEtaMin parsed from
// the same structured block. We re-scan the buffer text for these fields.

function enrichProMarker(rawText: string, base: ProMarker): ProMarker {
  // Find the structured block lines AFTER the marker line.
  const lines = rawText.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^\[ORCH:(WAITING|PROGRESS|GOAL_READY|STUCK)\]/.test(l))
  if (idx < 0) return base
  const after = lines.slice(idx + 1)

  const m: ProMarker = { ...base }
  let i = 0
  let captureOptions = false
  let captureDelta = false
  const options: string[] = []
  const deltaLines: string[] = []

  while (i < after.length) {
    const line = after[i]
    if (captureOptions) {
      const opt = line.match(/^\s+-\s+(.+)$/)
      if (opt) { options.push(opt[1].trim()); i++; continue }
      captureOptions = false
    }
    if (captureDelta) {
      // delta block: indented or non-key lines
      if (/^\s+\S/.test(line) || (line.trim() !== '' && !/^[A-Z_]+:/.test(line))) {
        deltaLines.push(line)
        i++
        continue
      }
      captureDelta = false
    }
    const km = line.match(/^([A-Z_]+):\s*(.*)$/)
    if (km) {
      const key = km[1]
      const val = km[2].trim()
      if (key === 'DECISION_SHAPE' && /^(reply|choose|approve|route|validate|transition)$/.test(val)) {
        m.shape = val as ProMarker['shape']
      } else if (key === 'ARTIFACT') {
        m.artifactPath = val
      } else if (key === 'OPTIONS') {
        captureOptions = true
        if (val) options.push(val)
      } else if (key === 'ASSUMPTION') {
        m.assumption = val
      } else if (key === 'DELTA') {
        captureDelta = true
      } else if (key === 'SUBAGENT_ETA_MIN') {
        const n = Number(val)
        if (Number.isFinite(n)) m.subagentEtaMin = n
      }
    }
    i++
  }
  if (options.length) m.options = options
  if (deltaLines.length) m.delta = deltaLines.join('\n').trim()
  return m
}

// ----- Activity log helpers -----

function appendLog(projectPath: string, entry: ActivityEntry): void {
  const path = join(projectPath, PRO_DIR, 'log.md')
  mkdirSync(dirname(path), { recursive: true })
  const line = `- ${new Date(entry.at).toISOString()} | ${entry.kind} | ${entry.summary}\n`
  appendFileSync(path, line)
}

function appendTranscript(projectPath: string, blockMarkdown: string): void {
  const path = join(projectPath, PRO_DIR, 'transcript.md')
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, blockMarkdown.endsWith('\n') ? blockMarkdown : blockMarkdown + '\n')
}

// ----- State machine -----

export class AutopilotProStateMachine {
  state: ProState
  private opts: AutopilotProOptions
  private api: ApiClient
  private cost: CostTracker
  private watcher: PtyWatcher
  private detachPty: (() => void) | null = null
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private maxSilenceMs: number
  private baseMaxSilenceMs: number
  // PRO maintains its own raw buffer so enrichProMarker can scan the full
  // structured block AFTER the marker line. The classic SettledSnapshot.text
  // contains only the text BEFORE the marker, which is too narrow for PRO.
  private proBuffer = ''
  private phaseTrackerEscalated = false
  private stage3KickoffSentForPhase: string | null = null
  private stage4KickoffSent = false
  private metaAutoFired = false

  constructor(opts: AutopilotProOptions, apiOverride?: ApiClient, ptyIdleMs = 1500, maxSilenceMs = DEFAULT_MAX_SILENCE_MS) {
    this.opts = opts
    this.api = apiOverride ?? makeApiClient(opts.apiProvider, opts.apiKey, opts.plannerModel)
    this.cost = new CostTracker(join(opts.projectPath, PRO_DIR), opts.costCapUsd, (pct) => {
      if (pct === 100) this.transition('discovery', 'cost cap reached')  // pause — keep stage but stop running
    })
    this.maxSilenceMs = maxSilenceMs
    this.baseMaxSilenceMs = maxSilenceMs

    // Reconcile artifact approval state on startup (auto-unapprove drifted files).
    const artifacts = reconcile(opts.projectPath)

    this.state = {
      stage: this.computeInitialStage(artifacts),
      currentPhaseId: null,
      currentTaskId: null,
      artifacts,
      cycleCount: 0,
      costUsd: this.cost.totalUsd,
      costCapUsd: this.cost.capUsd,
      recentLog: [],
      escalationReason: null,
      validation: {},
      subagentRunning: false,
      subagentEtaMs: 0,
    }

    this.watcher = new PtyWatcher({
      idleMs: ptyIdleMs,
      onSettle: (snap) => {
        // Use our own buffer for PRO enrichment (it contains the full structured
        // block including everything AFTER the marker). The classic snap.text is
        // the before-marker excerpt, too narrow for PRO.
        const enriched = enrichProMarker(this.proBuffer, snap.marker as ProMarker)
        this.proBuffer = ''  // clear after settle
        this.onSettled({
          ...snap,
          marker: enriched,
        } as ProSettledSnapshot)
      },
    })
  }

  private computeInitialStage(artifacts: Record<string, import('./types').ArtifactState>): ProStage {
    const spec = artifacts['spec.md']
    const plan = artifacts['plan.md']
    if (!spec) return 'discovery'
    if (!spec.approved) return 'discovery'
    if (!plan) return 'planning'
    if (!plan.approved) return 'planning'
    return 'implementation'
  }

  // ---- public control ----

  async start(): Promise<void> {
    this.detachPty = this.opts.onPtyData(this.opts.terminalId, (data) => {
      this.armSilenceTimer()
      this.proBuffer += data
      this.watcher.feed(data)
    })

    this.state.validation = discoverValidation(this.opts.projectPath)

    this.opts.writeToPty(this.opts.terminalId, DOER_SYSTEM_PROMPT_PRO + '\r')

    // Stage-aware kickoff message
    const kickoff = this.kickoffForStage(this.state.stage)
    if (kickoff) this.opts.writeToPty(this.opts.terminalId, kickoff + '\r')

    this.armSilenceTimer()
    this.notify()
  }

  pause(): void {
    this.clearSilenceTimer()
    this.appendActivity('orchestrator-pause', 'user pause')
    this.notify()
  }

  resume(): void {
    this.armSilenceTimer()
    this.appendActivity('orchestrator-resume', 'resumed')
    this.notify()
  }

  stop(): void {
    if (this.detachPty) { this.detachPty(); this.detachPty = null }
    this.clearSilenceTimer()
    this.appendActivity('orchestrator-pause', 'stopped')
    this.notify()
  }

  replyToWaiting(text: string): void {
    this.opts.writeToPty(this.opts.terminalId, text + '\r')
    this.appendActivity('orchestrator-reply', `Manual reply: ${text.slice(0, 80)}`)
    this.recordTranscript({
      kind: 'user-manual',
      doerQuestion: '(user-initiated)',
      orchestratorBody: text,
      shape: 'reply',
    })
  }

  /** For tests — feed raw PTY data, mirroring production listener. */
  feedPty(data: string): void {
    this.armSilenceTimer()
    this.proBuffer += data
    this.watcher.feed(data)
  }

  // ---- core loop ----

  private async onSettled(snap: ProSettledSnapshot): Promise<void> {
    const m = snap.marker

    this.appendActivity('doer-marker', `${m.kind}${m.shape ? ` shape=${m.shape}` : ''}${m.subgoalId ? ` ${m.subgoalId}` : ''}`)

    // Handle sub-agent ETA window — extend silence guard for the duration.
    if (m.subagentEtaMin && m.subagentEtaMin > 0) {
      this.state.subagentRunning = true
      this.state.subagentEtaMs = m.subagentEtaMin * 60_000
      this.maxSilenceMs = Math.max(this.baseMaxSilenceMs, m.subagentEtaMin * 60_000 + 2 * 60_000)
      this.armSilenceTimer()
      this.opts.writeToPty(this.opts.terminalId, 'Acknowledged. Proceeding with sub-agent.\r')
      this.notify()
      return
    } else if (this.state.subagentRunning) {
      // Sub-agent finished — revert silence guard.
      this.state.subagentRunning = false
      this.state.subagentEtaMs = 0
      this.maxSilenceMs = this.baseMaxSilenceMs
    }

    // Cost cap check.
    if (this.cost.isOverCap()) {
      this.appendActivity('cost-threshold', 'cost cap reached — pausing')
      this.notify()
      return
    }

    // Reconcile artifact approval state every cycle (auto-unapprove drifted files).
    this.state.artifacts = reconcile(this.opts.projectPath)

    // Phase tracker: derive currentPhaseId / currentTaskId from plan.md.
    this.updatePhaseTracker()

    // Pick the shape (default 'reply' for back-compat).
    const shape = m.shape ?? 'reply'

    // Build artifact-content extra for approve shape so the planner can see what to evaluate.
    let artifactContent: string | undefined
    if (shape === 'approve' && m.artifactPath) {
      const path = join(this.opts.projectPath, m.artifactPath)
      if (existsSync(path)) {
        artifactContent = readFileSync(path, 'utf-8').slice(0, 4000)
      }
    }

    // Call planner.
    let out
    try {
      out = await decidePro(this.api, {
        shape,
        stage: this.state.stage,
        goalSummary: this.opts.freeTextIdea,
        artifacts: this.state.artifacts,
        currentPhaseId: this.state.currentPhaseId,
        currentTaskId: this.state.currentTaskId,
        validation: this.state.validation,
        lastSnapshot: snap,
        recentLogTail: this.state.recentLog.slice(-5),
        options: m.options,
        artifactPath: m.artifactPath,
        artifactContent,
        assumption: m.assumption,
        delta: m.delta,
      })
    } catch (e: any) {
      this.state.escalationReason = `planner error: ${e?.message ?? 'unknown'}`
      this.appendActivity('escalation', this.state.escalationReason)
      this.notify()
      return
    }

    this.cost.add(out.costUsd)
    this.state.costUsd = this.cost.totalUsd
    this.state.cycleCount++

    // Apply principles enforcement to approve verdicts.
    let result = out.result
    if (result.shape === 'approve') {
      const enforced = applyPrinciplesToApprove(result, { marker: m })
      result = enforced.result
      if (enforced.violations.length > 0) {
        this.appendActivity('escalation', `principles: ${enforced.violations.map((v) => v.name).join(', ')}`)
      }
    }

    await this.dispatch(result, m)
    this.notify()
  }

  // ---- shape-specific dispatch ----

  private async dispatch(result: ProDecideResult, marker: ProMarker): Promise<void> {
    switch (result.shape) {
      case 'reply': {
        this.opts.writeToPty(this.opts.terminalId, result.text + '\r')
        this.appendActivity('orchestrator-reply', result.text.slice(0, 100))
        this.recordTranscript({ kind: 'reply', doerQuestion: marker.question || marker.text, orchestratorBody: result.text, shape: 'reply' })
        return
      }

      case 'choose': {
        const reply = `Pick: ${result.option}. Rationale: ${result.why}`
        this.opts.writeToPty(this.opts.terminalId, reply + '\r')
        this.appendActivity('orchestrator-reply', `chose ${result.option}: ${result.why.slice(0, 60)}`)
        this.recordTranscript({ kind: 'choose', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'choose' })
        return
      }

      case 'approve': {
        const path = marker.artifactPath
        if (!path) {
          // Approve shape without artifact path is meaningless — degrade.
          this.opts.writeToPty(this.opts.terminalId, 'Approve requires ARTIFACT path. Please re-emit.\r')
          return
        }
        const kind = this.inferArtifactKind(path)
        const phaseId = this.inferPhaseId(path)
        if (result.verdict === 'approve') {
          markApproved(this.opts.projectPath, kind, phaseId)
          this.state.artifacts = readState(this.opts.projectPath)
          // Maybe advance stage automatically based on the new approval state.
          this.maybeAdvanceStage()
          // Note: stage 'phase-review' is NOT advanced here — updatePhaseTracker
          // on the NEXT settled cycle reads the now-approved review and decides
          // whether to re-enter Stage 3 for the next phase, return to
          // implementation, or move to final-review.
          const reply = `Approved: ${path}. ${result.why ?? ''} Proceed.`
          this.opts.writeToPty(this.opts.terminalId, reply + '\r')
          this.appendActivity('orchestrator-reply', `approved ${path}`)
          this.recordTranscript({ kind: 'approve', doerQuestion: `(approve) ${path}`, orchestratorBody: reply, shape: 'approve' })
        } else {
          // refine — increment counter, possibly escalate
          const newCount = incrementRefineCount(this.opts.projectPath, kind, phaseId)
          this.state.artifacts = readState(this.opts.projectPath)
          if (newCount > REFINE_LIMIT) {
            this.state.escalationReason = `refinement-bound-exceeded: ${path}`
            this.appendActivity('escalation', this.state.escalationReason)
            this.opts.writeToPty(this.opts.terminalId,
              `Refinement bound (${REFINE_LIMIT}) exceeded for ${path}. Escalating to human.\r`)
            return
          }
          const reply = `Refine ${path} (attempt ${newCount}/${REFINE_LIMIT}): ${result.directive}`
          this.opts.writeToPty(this.opts.terminalId, reply + '\r')
          this.appendActivity('orchestrator-reply', `refine ${path} (${newCount})`)
          this.recordTranscript({ kind: 'refine', doerQuestion: `(refine) ${path}`, orchestratorBody: reply, shape: 'approve' })
        }
        return
      }

      case 'route': {
        const reply = `Use the ${result.skill} skill. ${result.why}`
        this.opts.writeToPty(this.opts.terminalId, reply + '\r')
        this.appendActivity('orchestrator-reply', `route: ${result.skill}`)
        this.recordTranscript({ kind: 'route', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'route' })
        return
      }

      case 'validate': {
        if (result.verdict === 'verified') {
          const reply = `Verified — proceed with that assumption.`
          this.opts.writeToPty(this.opts.terminalId, reply + '\r')
          this.appendActivity('orchestrator-reply', 'verified')
          this.recordTranscript({ kind: 'validate', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'validate' })
        } else {
          const reply = `Research first: ${result.query}. Report findings before proceeding.`
          this.opts.writeToPty(this.opts.terminalId, reply + '\r')
          this.appendActivity('orchestrator-reply', `research: ${result.query.slice(0, 60)}`)
          this.recordTranscript({ kind: 'validate', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'validate' })
        }
        return
      }

      case 'transition': {
        if (result.action === 'advance') {
          // Validate gates before allowing advance
          this.maybeAdvanceStage()
          const reply = `Stage now: ${this.state.stage}. ${result.why}`
          this.opts.writeToPty(this.opts.terminalId, reply + '\r')
          this.appendActivity('orchestrator-resume', `stage→${this.state.stage}`)
          this.recordTranscript({ kind: 'transition', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'transition' })
        } else if (result.action === 'cycle') {
          const reply = `Cycle current stage. ${result.why}`
          this.opts.writeToPty(this.opts.terminalId, reply + '\r')
          this.appendActivity('orchestrator-resume', 'cycle')
          this.recordTranscript({ kind: 'transition', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'transition' })
        } else {
          // action === 'final-review'
          if (this.state.stage === 'final-review') {
            // We're already in Stage 4 — the doer is signalling Stage 4 complete.
            this.state.stage = 'done'
            const reply = `Final review acknowledged. Run complete. Firing meta-orchestrator…`
            this.opts.writeToPty(this.opts.terminalId, reply + '\r')
            this.appendActivity('orchestrator-resume', 'stage→done')
            this.recordTranscript({ kind: 'transition', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'transition' })
            void this.fireMetaAutoAsync()
          } else {
            // Pre-Stage-4 final-review request (legacy path) — set stage and let next cycle handle kickoff.
            this.state.stage = 'final-review'
            const reply = `Advancing to final review. ${result.why}`
            this.opts.writeToPty(this.opts.terminalId, reply + '\r')
            this.appendActivity('orchestrator-resume', 'final-review')
            this.recordTranscript({ kind: 'transition', doerQuestion: marker.question || marker.text, orchestratorBody: reply, shape: 'transition' })
          }
        }
        return
      }
    }
  }

  private async fireMetaAutoAsync(): Promise<void> {
    if (this.metaAutoFired) return
    this.metaAutoFired = true
    try {
      const { runMetaReflect } = await import('./meta')
      const result = await runMetaReflect(this.api, this.opts.projectPath)
      this.recordTranscript({
        kind: 'meta-auto',
        doerQuestion: '(auto-fire on Stage 4 done)',
        orchestratorBody: `classification=${result.classification}: ${result.summary}`,
        shape: 'meta',
      })
      this.appendActivity('orchestrator-resume', `meta auto-fired: ${result.classification}`)
      this.clearSilenceTimer()
      this.notify()
    } catch (e: any) {
      this.appendActivity('escalation', `meta auto-fire failed: ${e?.message ?? 'unknown'}`)
      this.notify()
    }
  }

  // ---- stage transitions ----

  private updatePhaseTracker(): void {
    // Only run during implementation or phase-review stages.
    if (this.state.stage !== 'implementation' && this.state.stage !== 'phase-review') return
    const { content } = readArtifact(this.opts.projectPath, 'plan')
    if (!content) return
    const phases = parsePhases(content)
    if (phases.length === 0) {
      if (!this.phaseTrackerEscalated) {
        this.state.escalationReason = 'plan.md has no parseable phases'
        this.appendActivity('escalation', this.state.escalationReason)
        this.phaseTrackerEscalated = true
      }
      return
    }
    this.phaseTrackerEscalated = false

    // Find the first phase whose tasks are all done but whose review is missing-or-not-approved.
    const a = this.state.artifacts
    const phaseAwaitingReview = phases.find((p) =>
      phaseDoneFromTasks(p) && a[`reviews/${p.id}.md`]?.approved !== true
    )

    if (phaseAwaitingReview) {
      // Enter Stage 3 for this phase.
      this.state.stage = 'phase-review'
      this.state.currentPhaseId = phaseAwaitingReview.id
      this.state.currentTaskId = null
      if (this.stage3KickoffSentForPhase !== phaseAwaitingReview.id) {
        this.opts.writeToPty(this.opts.terminalId, stage3Kickoff(phaseAwaitingReview.id) + '\r')
        this.appendActivity('orchestrator-resume', `stage 3 kickoff: ${phaseAwaitingReview.id}`)
        this.stage3KickoffSentForPhase = phaseAwaitingReview.id
      }
      return
    }

    // No phase awaits review. Either still implementing OR all reviews approved.
    const allDoneAndReviewed = phases.every((p) =>
      phaseDoneFromTasks(p) && a[`reviews/${p.id}.md`]?.approved === true
    )
    if (allDoneAndReviewed) {
      this.state.stage = 'final-review'
      this.state.currentPhaseId = null
      this.state.currentTaskId = null
      this.stage3KickoffSentForPhase = null
      if (!this.stage4KickoffSent) {
        this.opts.writeToPty(this.opts.terminalId, stage4Kickoff() + '\r')
        this.appendActivity('orchestrator-resume', 'stage 4 kickoff')
        this.stage4KickoffSent = true
      }
      return
    }

    // Implementation: pick the first non-done phase.
    this.state.stage = 'implementation'
    this.stage3KickoffSentForPhase = null
    const cp = currentPhase(phases)
    if (cp) {
      this.state.currentPhaseId = cp.id
      const nextTask = cp.tasks.find((t) => !t.done)
      this.state.currentTaskId = nextTask?.id ?? null
    } else {
      this.state.currentPhaseId = null
      this.state.currentTaskId = null
    }
  }

  private maybeAdvanceStage(): void {
    const a = this.state.artifacts
    const specOk = a['spec.md']?.approved === true
    const planOk = a['plan.md']?.approved === true
    const prev = this.state.stage
    if (this.state.stage === 'discovery' && specOk) this.state.stage = 'planning'
    if (this.state.stage === 'planning' && planOk) this.state.stage = 'implementation'
    if (prev !== this.state.stage) {
      this.appendActivity('orchestrator-resume', `stage advance: ${prev} → ${this.state.stage}`)
      this.phaseTrackerEscalated = false
    }
  }

  private transition(_phase: ProStage, reason: string): void {
    this.appendActivity('orchestrator-pause', reason)
    this.clearSilenceTimer()
  }

  private inferArtifactKind(path: string): ArtifactKind {
    if (/spec\.md$/.test(path)) return 'spec'
    if (/plan\.md$/.test(path)) return 'plan'
    if (/impl\//.test(path)) return 'impl-doc'
    if (/reviews\//.test(path)) return 'review'
    return 'spec'  // sensible default
  }

  private inferPhaseId(path: string): string | undefined {
    const m = path.match(/(?:impl|reviews)\/([^/]+)\.md$/)
    return m?.[1]
  }

  private kickoffForStage(stage: ProStage): string | null {
    switch (stage) {
      case 'discovery':
        return `STAGE 0 — DISCOVERY. Idea: """${this.opts.freeTextIdea}"""\n` +
               `Produce .autopilot-pro/spec.md with goal, non-goals, acceptance, constraints. ` +
               `When complete, emit [ORCH:WAITING] with DECISION_SHAPE: approve and ARTIFACT: spec.md.`
      case 'planning':
        return `STAGE 1 — PLANNING. Spec is approved. Produce .autopilot-pro/plan.md ` +
               `with phased tasks (checkboxes). When complete, emit DECISION_SHAPE: approve, ARTIFACT: plan.md.`
      case 'implementation':
        return `STAGE 2 — IMPLEMENTATION. Spec + plan approved. Begin executing the first phase's tasks. ` +
               `Use structured Status Reports with DECISION_SHAPE per turn.`
      case 'phase-review':
        return `STAGE 3 — PHASE REVIEW. Produce .autopilot-pro/reviews/<phase>.md and emit approve.`
      case 'final-review':
        return `STAGE 4 — FINAL REVIEW. Cross-phase sign-off.`
      case 'done':
        return null
    }
  }

  // ---- transcript / log helpers ----

  private recordTranscript(args: {
    kind: string
    doerQuestion: string
    orchestratorBody: string
    shape: string
  }): void {
    const ts = new Date().toISOString()
    const cycle = this.state.cycleCount
    const cost = `$${this.state.costUsd.toFixed(4)}`
    const lines = [
      `## ${ts} — Cycle ${cycle} — ${args.kind} (shape=${args.shape}, stage=${this.state.stage})`,
      '',
      `**Doer:**`,
      '',
      args.doerQuestion ? `> ${args.doerQuestion.replace(/\n/g, '\n> ')}` : '> (no question)',
      '',
      `**Orchestrator** (model: ${this.opts.plannerModel}, cost so far: ${cost})`,
      '',
      args.orchestratorBody ? `> ${args.orchestratorBody.replace(/\n/g, '\n> ')}` : '> (no body)',
      '',
      '---',
      '',
    ]
    appendTranscript(this.opts.projectPath, lines.join('\n'))
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

  // ---- silence timer ----

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = setTimeout(() => this.onSilenceExceeded(), this.maxSilenceMs)
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
    const minutes = Math.round(this.maxSilenceMs / 60000)
    this.state.escalationReason = `doer silent for ${minutes}+ minutes`
    this.appendActivity('escalation', this.state.escalationReason)
    this.notify()
  }
}

// Public factory.
export function createAutopilotPro(
  opts: AutopilotProOptions,
  apiOverride?: ApiClient,
  ptyIdleMs?: number,
  maxSilenceMs?: number,
): AutopilotProStateMachine {
  return new AutopilotProStateMachine(opts, apiOverride, ptyIdleMs, maxSilenceMs)
}

// Re-export findLastMarker for tests that want to compose enrichment manually.
export { findLastMarker, enrichProMarker }
