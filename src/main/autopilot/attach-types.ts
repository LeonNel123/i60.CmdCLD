import type { ApiProvider, ApiUsage, MarkerKind } from './types'

export type AttachClassification =
  | 'idle'
  | 'waiting_for_user'
  | 'permission_request'
  | 'working'
  | 'blocked'
  | 'unknown'

export type AttachLifecycleStatus =
  | 'drafting'
  | 'drafted'
  | 'sending_bridge'
  | 'watching'
  | 'attached'
  | 'no_marker_yet'
  | 'failed'
  | 'cancelled'

export interface AttachDraftRequest {
  terminalId: string
  scrollback: string
  useLlm: boolean
  userAnswer?: string
  providerConfigured: boolean
  provider: ApiProvider
  model: string
}

export interface AttachDraft {
  terminalId: string
  classification: AttachClassification
  bridgePrompt: string
  cleanTail: string
  usedLlm: boolean
  provider: ApiProvider
  model: string
  usage?: ApiUsage
  estimatedCostUsd?: number
  error?: string
}

export interface AttachConfirmRequest {
  terminalId: string
  bridgePrompt: string
}

export interface AttachSessionStatus {
  id: string
  terminalId: string
  status: AttachLifecycleStatus
  baselineOffset: number
  bridgeSentAt: number | null
  lastMarker: { kind: MarkerKind; receivedAt: number; text?: string; raw?: string } | null
  lastError: string | null
  message: string
}
