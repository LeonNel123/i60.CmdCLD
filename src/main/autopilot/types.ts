// Shared types for the Autopilot Orchestrator.

export type AutopilotPhase = 'idle' | 'wizard' | 'awaiting_goal_review' | 'executing' | 'paused' | 'escalated' | 'completed' | 'stopped'

export type MarkerKind = 'WAITING' | 'PROGRESS' | 'GOAL_READY' | 'STUCK'

export interface DoerMarker {
  kind: MarkerKind
  text: string                  // text after the marker label
  raw: string                   // the full marker line
  subgoalId?: string            // for PROGRESS
  status?: 'done' | 'partial' | 'blocked'  // for PROGRESS
}

export interface SettledSnapshot {
  text: string                  // ANSI-stripped text after the last marker
  marker: DoerMarker
  receivedAt: number            // unix ms
}

export interface Subgoal {
  id: string
  description: string
  shell?: string                // optional verification command
  judge?: string                // optional LLM-eval question
  status: 'pending' | 'partial' | 'done' | 'blocked'
}

export interface Milestone {
  id: string                    // e.g. 'm1'
  name: string
  status: 'pending' | 'in-progress' | 'done' | 'blocked'
  subgoals: Subgoal[]
  notes: string
}

export interface Goal {
  goal: string
  nonGoals: string[]
  acceptance: { kind: 'shell' | 'judge'; value: string }[]
  constraints: {
    maxIterations: number
    maxApiCostUsd: number
    maxDoerOutputPerReset: number
  }
}

export interface AutopilotState {
  phase: AutopilotPhase
  goal: Goal | null
  milestones: Milestone[]
  currentMilestoneId: string | null
  cycleCount: number
  costUsd: number
  costCapUsd: number
  lastDecisionText: string         // for the panel's "last action" line
  recentLog: ActivityEntry[]       // last 10 entries
  escalationReason: string | null
}

export interface ActivityEntry {
  at: number                       // unix ms
  kind: 'doer-marker' | 'orchestrator-reply' | 'orchestrator-reset' | 'orchestrator-pause' | 'orchestrator-resume' | 'cost-threshold' | 'escalation'
  summary: string
}

// Decision call output
export type DecideResult =
  | { kind: 'reply'; text: string }
  | { kind: 'reset' }
  | { kind: 'done'; evidence: string }
  | { kind: 'escalate'; reason: string }

export interface DecideInput {
  goal: Goal
  milestones: Milestone[]
  currentMilestoneId: string | null
  lastSnapshot: SettledSnapshot
  recentLogTail: ActivityEntry[]   // last 5 entries
}

export interface ApiUsage {
  inputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
}

export interface ApiClient {
  decide(input: DecideInput): Promise<{ result: DecideResult; usage: ApiUsage }>
  /** Cost in USD for a usage record at the client's current model rates. */
  estimateCost(usage: ApiUsage): number
}

export type ApiProvider = 'anthropic' | 'openrouter'

export interface AutopilotOptions {
  terminalId: string
  projectPath: string
  freeTextIdea: string
  costCapUsd: number
  maxIterations: number
  apiProvider: ApiProvider
  apiKey: string
  plannerModel: string
  // Plumbing — provided by the host (CmdCLD main process)
  writeToPty: (terminalId: string, data: string) => void
  onPtyData: (terminalId: string, listener: (data: string) => void) => () => void
  onUpdate: (state: AutopilotState) => void
}
