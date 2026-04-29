import { AutopilotStateMachine } from './state-machine'
import type { AutopilotOptions, AutopilotState } from './types'

export type { AutopilotState, AutopilotOptions } from './types'

export interface AutopilotHandle {
  readonly state: AutopilotState
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): void
  approveGoal(): void
  replyToWaiting(text: string): void
}

export function createAutopilot(opts: AutopilotOptions): AutopilotHandle {
  const sm = new AutopilotStateMachine(opts)
  return {
    get state() { return sm.state },
    start: () => sm.start(),
    pause: () => sm.pause(),
    resume: () => sm.resume(),
    stop: () => sm.stop(),
    approveGoal: () => sm.approveGoal(),
    replyToWaiting: (text: string) => sm.replyToWaiting(text),
  }
}
