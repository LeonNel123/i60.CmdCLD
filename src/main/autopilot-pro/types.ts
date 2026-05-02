// Shared types for Autopilot PRO (Wave 3.0).
// Lives alongside src/main/autopilot/ — does NOT replace it.

import type {
  ApiUsage, ActivityEntry, SettledSnapshot, ValidationCommands, DoerMarker,
} from '../autopilot/types'
import type { AgentCli } from '../../shared/agent-cli'

// ----- Stages -----

export type ProStage = 'research' | 'discovery' | 'planning' | 'implementation' | 'phase-review' | 'final-review' | 'done'

// ----- Decision shapes -----

export type DecisionShape =
  | 'reply'
  | 'choose'
  | 'approve'
  | 'route'
  | 'validate'
  | 'transition'
  | 'decide-with-rationale'
  | 'research'

export const ALL_DECISION_SHAPES: DecisionShape[] = [
  'reply', 'choose', 'approve', 'route', 'validate', 'transition', 'decide-with-rationale', 'research',
]

// ----- Artifacts -----

export type ArtifactKind = 'spec' | 'plan' | 'impl-doc' | 'review' | 'final-review' | 'adr' | 'research-summary'

export interface ArtifactState {
  path: string
  kind: ArtifactKind
  approved: boolean
  sha256: string | null
  approvedAt: number | null
  refineCount: number
}

// ----- Marker (extends classic DoerMarker) -----

export interface ProMarker extends DoerMarker {
  proStatus?: string              // raw STATUS: line value (e.g. 'spec-update-request', 'subagent-running')
  shape?: DecisionShape           // DECISION_SHAPE field in Status Report
  artifactPath?: string           // ARTIFACT — when shape=approve
  options?: string[]              // OPTIONS — when shape=choose (each element "<letter>: <description>")
  assumption?: string             // ASSUMPTION — when shape=validate
  delta?: string                  // DELTA — when proStatus=spec-update-request
  subagentEtaMin?: number         // SUBAGENT_ETA_MIN — when proStatus=subagent-running
  optionsRationale?: { option: string; pros: string[]; cons: string[] }[]   // OPTIONS_RATIONALE — when shape=decide-with-rationale
  researchTopics?: { slug: string; query: string; sources?: string[]; force?: boolean }[]
  researchTopic?: string
  researchForce?: boolean
}

// ----- Settled snapshot for PRO (just retypes marker) -----

export interface ProSettledSnapshot extends Omit<SettledSnapshot, 'marker'> {
  marker: ProMarker
}

// ----- State -----

export interface ProState {
  stage: ProStage
  control?: 'idle' | 'running' | 'paused' | 'blocked' | 'stopped'
  currentPhaseId: string | null
  currentTaskId: string | null
  artifacts: Record<string, ArtifactState>
  cycleCount: number
  costUsd: number
  costCapUsd: number
  recentLog: ActivityEntry[]
  escalationReason: string | null
  validation: ValidationCommands
  subagentRunning: boolean
  subagentEtaMs: number  // 0 if no subagent running
  liveStatus: string | null
  lastMarker: { kind: string; subgoalId?: string; receivedAt: number } | null
  permissionRequest: { text: string; detectedAt: number } | null
  researchInFlight?: {
    triggerStage: ProStage
    pendingTopics: string[]
    spendByTopic: Record<string, number>
    topicBudgets: Record<string, number>
  }
  researchHistory?: { slug: string; costUsd: number; outcome: 'written' | 'declined' | 'overrun' | 'reused' }[]
}

// ----- Research topic decision -----

export interface ResearchTopicDecision {
  slug: string
  approve: boolean
  budgetUsd?: number
  reuse?: string | null
  reason?: string
}

// ----- Decision results (one per shape) -----

export type ProDecideResult =
  | { shape: 'reply';      text: string }
  | { shape: 'choose';     option: string; why: string }
  | { shape: 'approve';    verdict: 'approve';  why?: string }
  | { shape: 'approve';    verdict: 'refine';   directive: string }
  | { shape: 'route';      skill: string; why: string }
  | { shape: 'validate';   verdict: 'verified' }
  | { shape: 'validate';   verdict: 'research'; query: string }
  | { shape: 'transition'; action: 'advance' | 'cycle' | 'final-review'; why: string }
  | { shape: 'decide-with-rationale'; recommendation: string; why: string }
  | { shape: 'research'; topics: ResearchTopicDecision[] }

// ----- Meta-orchestrator output -----

export type MetaClassification = 'extend' | 'done' | 'human-required'

export interface MetaReflectResult {
  classification: MetaClassification
  summary: string
  draftSpec?: string         // present iff classification === 'extend'
  openQuestions?: string[]   // present iff classification === 'human-required'
}

// ----- Decision input passed to the planner -----

export interface ProDecideInput {
  shape: DecisionShape
  stage: ProStage
  goalSummary: string         // short description of what we're driving toward
  artifacts: Record<string, ArtifactState>
  currentPhaseId: string | null
  currentTaskId: string | null
  validation: ValidationCommands
  lastSnapshot: ProSettledSnapshot
  recentLogTail: ActivityEntry[]
  // Shape-specific extras
  options?: string[]            // for shape=choose (parsed from marker)
  artifactPath?: string         // for shape=approve
  artifactContent?: string      // for shape=approve, the artifact body
  assumption?: string           // for shape=validate
  delta?: string                // for transition spec-update
  optionsRationale?: { option: string; pros: string[]; cons: string[] }[]   // for shape=decide-with-rationale
  researchTopics?: { slug: string; query: string; sources?: string[]; force?: boolean }[]
}

// ----- ApiClient extension for PRO -----
// PRO needs a low-level (system, user) → text call that's separate from the
// goal-oriented client.decide(). We add chat() to ApiClient in api-client.ts.
// This is the type so consumers know the new interface.

export interface ProChatArgs {
  system: string
  user: string
  maxTokens?: number   // default 400
}

export interface ProChatResult {
  text: string
  usage: ApiUsage
}

// ----- Principles -----

export type PrincipleSeverity = 'hard' | 'soft'

export interface Principle {
  name: string
  rule: string
  severity: PrincipleSeverity
  appliesToShapes: DecisionShape[]
}

export const PRINCIPLES: Principle[] = [
  {
    name: 'TDD',
    rule: 'Tests written first; failing test observed; impl that minimally passes.',
    severity: 'hard',
    appliesToShapes: ['approve'],
  },
  {
    name: 'YAGNI',
    rule: 'Narrowest scope that meets the spec; reject "while we are at it" expansions.',
    severity: 'soft',
    appliesToShapes: ['approve', 'choose'],
  },
  {
    name: 'VERIFICATION',
    rule: 'Prefer "ran the command, here is stdout" over "should work".',
    severity: 'soft',
    appliesToShapes: ['approve'],
  },
  {
    name: 'SECURITY',
    rule: 'Reject diffs that introduce shell injection, hardcoded secrets, or unsanitised input.',
    severity: 'hard',
    appliesToShapes: ['approve'],
  },
  {
    name: 'BOUNDARY',
    rule: 'Reject diffs that touch files outside the current task allowed-files list.',
    severity: 'hard',
    appliesToShapes: ['approve'],
  },
  {
    name: 'RESEARCH',
    rule: 'Any external claim ("library X does Y", "API Z returns W") goes through validate before depending on it.',
    severity: 'soft',
    appliesToShapes: ['validate', 'approve'],
  },
]

// ----- Phase tracker (Wave 3.1) -----

export interface TaskDescriptor {
  id: string                    // 'T1', 'T2', etc.
  description: string
  done: boolean                 // checkbox state
}

export interface PhaseDescriptor {
  id: string                    // 'phase-1', 'phase-2', etc.
  name: string                  // human-readable title
  tasks: TaskDescriptor[]
  status: 'pending' | 'in-progress' | 'done'
}

// ----- Options for the public factory -----

export interface AutopilotProOptions {
  terminalId: string
  projectPath: string
  freeTextIdea: string             // initial goal seed for Stage 0
  agentCli?: AgentCli
  costCapUsd: number
  apiProvider: 'anthropic' | 'openrouter'
  apiKey: string
  plannerModel: string
  maxDoerOutputPerReset?: number   // default 60000
  runtimeJson?: boolean            // default true; pass false in tests to disable runtime.json save/load
  budgetTracker?: boolean          // default true; pass false in tests to disable cross-run budget tracking
  researchEnabled?: boolean
  skipResearchStage?: boolean
  researchTopicBudgetUsd?: number
  // Plumbing
  writeToPty: (terminalId: string, data: string) => void
  onPtyData: (terminalId: string, listener: (data: string) => void) => () => void
  onUpdate: (state: ProState) => void
}

export const PRO_DIR = '.autopilot-pro'
