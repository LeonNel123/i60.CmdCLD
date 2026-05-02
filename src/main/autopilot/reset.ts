import { DOER_SYSTEM_PROMPT, RESET_SUMMARISE_PROMPT, buildResumePrompt } from './prompts'

export interface ResetOpts {
  writeToPty: (data: string) => void
  /** Resolves when the doer settles (idle + marker present). */
  waitForSettle: () => Promise<void>
  currentMilestoneId: string | null
  clearCommand?: string
  doerSystemPrompt?: string
}

export async function runResetSequence(opts: ResetOpts): Promise<void> {
  // 1. Ask for state summary
  opts.writeToPty(RESET_SUMMARISE_PROMPT + '\r')
  await opts.waitForSettle()

  // 2. Clear context
  opts.writeToPty(`${opts.clearCommand ?? '/clear'}\r`)
  await opts.waitForSettle()

  // 3. Re-inject system prompt
  opts.writeToPty((opts.doerSystemPrompt ?? DOER_SYSTEM_PROMPT) + '\r')

  // 4. Resume prompt
  opts.writeToPty(buildResumePrompt(opts.currentMilestoneId) + '\r')
}
