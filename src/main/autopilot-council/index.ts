import { AutopilotCouncilStateMachine } from './state-machine'
import type { AutopilotCouncilOptions, CouncilState } from './types'

export interface AutopilotCouncilHandle {
  start(): Promise<void>
  pause(): void
  resume(): Promise<void>
  stop(): void
  replyToWaiting(text: string): void
  respondToPermission(verdict: 'allow' | 'deny'): void
  getState(): CouncilState
}

export function createAutopilotCouncil(opts: AutopilotCouncilOptions): AutopilotCouncilHandle {
  const sm = new AutopilotCouncilStateMachine(opts)

  return {
    start: () => sm.start(),
    pause: () => sm.pause(),
    resume: () => sm.resume(),
    stop: () => sm.stop(),
    replyToWaiting: (text) => sm.replyToWaiting(text),
    respondToPermission: (verdict) => sm.respondToPermission(verdict),
    getState: () => sm.getState(),
  }
}

export type { AutopilotCouncilOptions, CouncilState } from './types'
export { AutopilotCouncilStateMachine } from './state-machine'
