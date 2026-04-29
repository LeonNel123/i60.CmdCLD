import { DOER_SYSTEM_PROMPT, RESET_SUMMARISE_PROMPT, buildResumePrompt } from './prompts'

export interface ResetOpts {
  writeToPty: (data: string) => void
  /** Resolves when the doer settles (idle + marker present). */
  waitForSettle: () => Promise<void>
  currentMilestoneId: string | null
}

export async function runResetSequence(opts: ResetOpts): Promise<void> {
  // 1. Ask for state summary
  opts.writeToPty(RESET_SUMMARISE_PROMPT + '\r')
  await opts.waitForSettle()

  // 2. Clear context
  opts.writeToPty('/clear\r')
  await opts.waitForSettle()

  // 3. Re-inject system prompt
  opts.writeToPty(DOER_SYSTEM_PROMPT + '\r')

  // 4. Resume prompt
  opts.writeToPty(buildResumePrompt(opts.currentMilestoneId) + '\r')
}
