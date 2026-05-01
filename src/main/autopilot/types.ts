// Shared types for the Autopilot Orchestrator.

export type AutopilotPhase = 'idle' | 'wizard' | 'awaiting_goal_review' | 'executing' | 'paused' | 'escalated' | 'completed' | 'stopped'

export type MarkerKind = 'WAITING' | 'PROGRESS' | 'GOAL_READY' | 'STUCK'

export interface DoerMarker {
  kind: MarkerKind
  text: string                  // text after the marker label
  raw: string                   // the full marker line
  subgoalId?: string            // for PROGRESS
  status?: 'done' | 'partial' | 'blocked'  // for PROGRESS
  // structured fields parsed from the Status Report block (item 4)
  filesChanged?: string[]
  tests?: string                                 // free-text, e.g. "134 passed / 0 failed"
  redPhase?: 'yes' | 'no' | 'na'
  boundaryOk?: boolean
  evidence?: string
  blocker?: string
  question?: string
}

export interface SettledSnapshot {
  text: string                  // ANSI-stripped text after the last marker
  marker: DoerMarker
  receivedAt: number            // unix ms
}

export interface SubgoalBoundary {
  allowedFiles?: string[]      // glob-ish patterns, doer-readable
  forbiddenFiles?: string[]
  allowedDeps?: string[]       // package names (informational)
}

export interface Subgoal {
  id: string
  description: string
  shell?: string                // optional verification command
  judge?: string                // optional LLM-eval question
  boundary?: SubgoalBoundary   // NEW
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

export interface ValidationCommands {
  test?: string
  build?: string
  typecheck?: string
  lint?: string
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
  validation: ValidationCommands   // NEW; default {}
  liveStatus: string | null
  lastMarker: { kind: MarkerKind; subgoalId?: string; status?: 'done' | 'partial' | 'blocked'; receivedAt: number } | null
  permissionRequest: { text: string; detectedAt: number } | null
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

export interface SteeringDocs {
  tech: string | null
  structure: string | null
}

export interface DecideInput {
  goal: Goal
  milestones: Milestone[]
  currentMilestoneId: string | null
  lastSnapshot: SettledSnapshot
  recentLogTail: ActivityEntry[]   // last 5 entries
  validation: ValidationCommands       // NEW
  learnings: string[]                  // NEW; tail of recent learnings (≤20 lines)
  steering: SteeringDocs               // NEW
}

export interface ApiUsage {
  inputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
}

export type DebugResult =
  | { kind: 'retry'; instruction: string }
  | { kind: 'block'; reason: string }
  | { kind: 'human'; reason: string }

export interface DebugInput {
  goal: Goal
  currentMilestoneId: string | null
  lastSnapshot: SettledSnapshot
  trigger: 'stuck' | 'partial-streak'
}

export interface ApiClient {
  decide(input: DecideInput): Promise<{ result: DecideResult; usage: ApiUsage }>
  debug(input: DebugInput): Promise<{ result: DebugResult; usage: ApiUsage }>   // NEW
  /**
   * Low-level (system, user) → text call. Used by Autopilot PRO (Wave 3.0+)
   * which has its own per-shape prompts independent of the goal-oriented
   * decide() pipeline. Optional so legacy test mocks don't need updating;
   * production AnthropicClient + OpenRouterClient both implement it.
   */
  chat?(args: { system: string; user: string; maxTokens?: number }): Promise<{ text: string; usage: ApiUsage }>
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
