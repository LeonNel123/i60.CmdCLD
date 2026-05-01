import { DOER_SYSTEM_PROMPT_PRO, RESET_SUMMARISE_PROMPT_PRO, buildResumePromptPro } from './prompts'
import type { ProState } from './types'

export interface ResetProOpts {
  writeToPty: (data: string) => void
  /** Resolves when the doer settles after the most recent write. */
  waitForSettle: () => Promise<void>
  state: ProState
}

/**
 * Run the PRO context-reset sequence:
 *   1. Ask the doer to write state.md (so we don't lose context).
 *   2. /clear Claude Code's context.
 *   3. Re-inject DOER_SYSTEM_PROMPT_PRO.
 *   4. Send a stage-aware resume prompt pointing at the right artifacts.
 *
 * Each write is followed by a waitForSettle so we don't pipeline writes
 * before the doer has acknowledged the previous one.
 */
export async function runResetSequencePro(opts: ResetProOpts): Promise<void> {
  // 1. Ask the doer to write state.md
  opts.writeToPty(RESET_SUMMARISE_PROMPT_PRO + '\r')
  await opts.waitForSettle()

  // 2. /clear context
  opts.writeToPty('/clear\r')
  await opts.waitForSettle()

  // 3. Re-inject system prompt
  opts.writeToPty(DOER_SYSTEM_PROMPT_PRO + '\r')

  // 4. Stage-aware resume
  opts.writeToPty(buildResumePromptPro(opts.state) + '\r')
}
