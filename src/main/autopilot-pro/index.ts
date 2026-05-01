// Public entry point for Autopilot PRO.
//
// Mirrors src/main/autopilot/index.ts but for the PRO state machine.
// Consumers (the IPC layer in src/main/index.ts) call createAutopilotPro()
// to produce a handle, then drive it via control verbs.

import type { AutopilotProOptions, ProState } from './types'
import { AutopilotProStateMachine } from './state-machine'
import { runMetaReflect } from './meta'
import type { ApiClient } from '../autopilot/types'
import { makeApiClient } from '../autopilot/api-client'

export interface AutopilotProHandle {
  /** Begin the run — discovery / planning / impl based on existing artifact state. */
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): void
  replyToWaiting(text: string): void
  respondToPermission(verdict: 'allow' | 'deny'): void
  /** Run the meta-orchestrator after a completed run. */
  runMeta(): Promise<import('./types').MetaReflectResult>
  /** Current state snapshot. */
  getState(): ProState
}

export function createAutopilotPro(opts: AutopilotProOptions): AutopilotProHandle {
  const sm = new AutopilotProStateMachine(opts)
  const client: ApiClient = makeApiClient(opts.apiProvider, opts.apiKey, opts.plannerModel)
  return {
    start: () => sm.start(),
    pause: () => sm.pause(),
    resume: () => sm.resume(),
    stop: () => sm.stop(),
    replyToWaiting: (text) => sm.replyToWaiting(text),
    respondToPermission: (verdict) => sm.respondToPermission(verdict),
    runMeta: () => runMetaReflect(client, opts.projectPath),
    getState: () => sm.state,
  }
}

// Re-exports for IPC layer convenience.
export type { AutopilotProOptions, ProState } from './types'
export { AutopilotProStateMachine } from './state-machine'
