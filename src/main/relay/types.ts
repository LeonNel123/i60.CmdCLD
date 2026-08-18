// Cross-session relay ("session mail") — phase 1 of CMDCLD-REQ-001.
// See docs/integration/outbound/CMDCLD-REQ-001-response.md for the contract:
// pointer-only nudges, stage-only delivery (no submit), everything visible.

export type RelayStatus = 'delivered' | 'queued' | 'refused' | 'cancelled'

export type RelayQueueReason = 'busy' | 'unknown-target' | 'ambiguous-target'

export interface RelayRequest {
  // Sender display name — host-stamped on both entry paths: from the MCP
  // caller's session token, or from the sending terminal's meta for UI sends.
  from: string
  // Target session id or name; resolved against live sessions at delivery time.
  to: string
  subject: string
  // Absolute path to the document the nudge points at.
  path: string
}

export interface RelayItem {
  id: string
  from: string
  to: string
  subject: string
  path: string
  createdAt: number
  reason: RelayQueueReason
}

export interface RelayLogEntry {
  id: string
  ts: number
  from: string
  to: string
  subject: string
  path: string
  status: RelayStatus
  // Delivery target once resolved, so the renderer can show a per-session log.
  terminalId?: string
  detail?: string
}

// A delivered-but-not-yet-acted-on nudge. Deliveries land here (flashing the
// target session's envelope) instead of being typed into the composer; the
// human stages, opens, or dismisses from the dialog. Only the autopilot
// auto-submit path still writes into the pty directly.
export interface RelayInboxItem {
  id: string
  from: string
  subject: string
  path: string
  ts: number
  // Session the nudge was delivered to.
  terminalId: string
  read: boolean
}

export interface RelayState {
  queue: RelayItem[]
  log: RelayLogEntry[]
  inbox: RelayInboxItem[]
}

export interface RelaySendResult {
  ok: boolean
  status: RelayStatus
  id: string
  error?: string
}
