import type { AgentCli } from '../../shared/agent-cli'
import type { ActivityEntry, SettledSnapshot, ValidationCommands } from '../autopilot/types'
import type { ProStage, ProMarker } from '../autopilot-pro/types'

export type { ProStage, ProMarker } from '../autopilot-pro/types'

export const COUNCIL_DIR = '.autopilot-council'

export type CouncilIntensity = 'light' | 'balanced' | 'strict'
export type CouncilGate = 'spec' | 'plan' | 'architecture' | 'stuck' | 'phase' | 'task' | 'final'
export type ReviewerVerdict = 'approve' | 'refine' | 'disagree' | 'escalate'
export type ReviewerRisk = 'low' | 'medium' | 'high'
export type CouncilControl = 'idle' | 'running' | 'paused' | 'blocked' | 'stopped'
export type CouncilRole = 'implementer' | 'reviewer'

export const COUNCIL_GATES_BY_INTENSITY: Record<CouncilIntensity, CouncilGate[]> = {
  light: ['spec', 'plan', 'final'],
  balanced: ['spec', 'plan', 'architecture', 'stuck', 'phase', 'final'],
  strict: ['spec', 'plan', 'architecture', 'stuck', 'phase', 'task', 'final'],
}

export const HIGH_RISK_CATEGORIES = [
  'security',
  'data-loss',
  'destructive-command',
  'irreversible-migration',
  'dependency-risk',
  'architecture',
  'boundary',
  'fabricated-evidence',
] as const

export type HighRiskCategory = typeof HIGH_RISK_CATEGORIES[number]

const INTENSITIES = new Set<CouncilIntensity>(['light', 'balanced', 'strict'])
const GATES = new Set<CouncilGate>(['spec', 'plan', 'architecture', 'stuck', 'phase', 'task', 'final'])
const VERDICTS = new Set<ReviewerVerdict>(['approve', 'refine', 'disagree', 'escalate'])
const RISKS = new Set<ReviewerRisk>(['low', 'medium', 'high'])

export function isCouncilIntensity(value: unknown): value is CouncilIntensity {
  return typeof value === 'string' && INTENSITIES.has(value as CouncilIntensity)
}

export function isCouncilGate(value: unknown): value is CouncilGate {
  return typeof value === 'string' && GATES.has(value as CouncilGate)
}

export function isReviewerVerdict(value: unknown): value is ReviewerVerdict {
  return typeof value === 'string' && VERDICTS.has(value as ReviewerVerdict)
}

export function isReviewerRisk(value: unknown): value is ReviewerRisk {
  return typeof value === 'string' && RISKS.has(value as ReviewerRisk)
}

export interface CouncilHumanApprovalSettings {
  highRiskDisagreement: boolean
  reviewerEscalation: boolean
  repeatedHighRiskBlock: boolean
  beforeEveryPhase: boolean
  beforeCommit: boolean
}

export const DEFAULT_COUNCIL_HUMAN_APPROVAL: CouncilHumanApprovalSettings = {
  highRiskDisagreement: true,
  reviewerEscalation: true,
  repeatedHighRiskBlock: true,
  beforeEveryPhase: false,
  beforeCommit: false,
}

export interface ReviewerFinding {
  title: string
  severity: 'info' | 'warning' | 'blocking'
  file?: string
  reason: string
  recommended_fix: string
}

export interface ReviewerDecision {
  verdict: ReviewerVerdict
  risk: ReviewerRisk
  findings: ReviewerFinding[]
  recommended_instruction: string
  rationale: string
}

export interface ReviewPacket {
  id: string
  gate: CouncilGate
  stage: ProStage
  createdAt: number
  projectPath: string
  goalSummary: string
  implementerCli: AgentCli
  reviewerCli: AgentCli
  marker: ProMarker | null
  artifactPath: string | null
  artifactExcerpt: string | null
  diffSummary: string | null
  filesChanged: string[]
  testEvidence: string | null
  recentDecisions: string[]
  terminalTail: string
}

export interface CouncilState {
  mode: 'council'
  stage: ProStage
  control: CouncilControl
  terminalId: string
  reviewerTerminalId: string | null
  implementerCli: AgentCli
  reviewerCli: AgentCli
  intensity: CouncilIntensity
  humanApproval: CouncilHumanApprovalSettings
  cycleCount: number
  costUsd: number
  costCapUsd: number
  validation: ValidationCommands
  recentLog: ActivityEntry[]
  liveStatus: string | null
  escalationReason: string | null
  lastMarker: { kind: string; subgoalId?: string; status?: string; receivedAt: number } | null
  lastCouncilDecision: CouncilArbitrationResult | null
  lastReviewPacketId: string | null
  reviewerStatus: 'idle' | 'starting' | 'reviewing' | 'timed-out' | 'protocol-violation' | 'failed'
  reviewerWarning: string | null
  permissionRequest: { text: string; detectedAt: number } | null
}

export type CouncilArbitrationAction =
  | 'continue'
  | 'instruct-implementer'
  | 'implementer-wins'
  | 'ask-user'
  | 'retry-reviewer'
  | 'ignore-reviewer'

export interface CouncilArbitrationResult {
  action: CouncilArbitrationAction
  gate: CouncilGate
  risk: ReviewerRisk
  instruction: string
  reason: string
  reviewerVerdict: ReviewerVerdict | 'timeout' | 'invalid'
}

export interface CouncilSettledSnapshot extends Omit<SettledSnapshot, 'marker'> {
  marker: ProMarker
}

export interface AutopilotCouncilOptions {
  terminalId: string
  reviewerTerminalId: string
  projectPath: string
  freeTextIdea: string
  implementerCli: AgentCli
  reviewerCli: AgentCli
  reviewerLaunchArgs: string
  intensity: CouncilIntensity
  humanApproval?: Partial<CouncilHumanApprovalSettings>
  costCapUsd: number
  apiProvider: 'anthropic' | 'openrouter'
  apiKey: string
  plannerModel: string
  writeToPty: (terminalId: string, data: string) => void | Promise<void>
  onPtyData: (terminalId: string, listener: (data: string) => void) => () => void
  onUpdate: (state: CouncilState) => void
  startReviewer: () => Promise<void>
  stopReviewer: () => void
}
