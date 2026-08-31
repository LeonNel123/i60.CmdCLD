/**
 * Rebuilding the previous session's terminals.
 *
 * The file store (main/last-session-store.ts) is well covered: atomic writes, corrupt
 * JSON tolerated, shape validated. What had no coverage was the reconstruction around
 * it, which is where the subtle rules live — per-CLI resume flags, which args to
 * remember for the folder, and the index alignment that carries minimized state. All
 * three fail silently rather than loudly, so they are pinned here as pure functions.
 */
import {
  AGENT_CLIS,
  ensureResumeArgs,
  getArgsForAgent,
  normalizeAgentCli,
  type AgentCli,
} from './agent-cli'

/** A project as persisted by the last-session store. */
export interface SavedSessionProject {
  path: string
  agentCli?: AgentCli
  claudeArgs?: string
  codexArgs?: string
  grokArgs?: string
  opencodeArgs?: string
  isPlainShell?: boolean
  minimized?: boolean
}

export interface RestoredSession {
  agentCli: AgentCli
  /** Per-CLI args for the restored terminal; carries resume flags when resuming. */
  argsByAgent: Record<AgentCli, string>
  /**
   * What to record as the folder's remembered launch — the project's own args, never the
   * resume flags. `--continue` belongs to this restore, not to the project: remembering
   * it would make every later open resume, and the flag would compound.
   */
  rememberArgs: string
}

export function resolveRestoredSession(saved: SavedSessionProject, resume: boolean): RestoredSession {
  const agentCli = normalizeAgentCli(saved.agentCli)
  const base = {
    claudeArgs: saved.claudeArgs ?? '',
    codexArgs: saved.codexArgs ?? '',
    grokArgs: saved.grokArgs ?? '',
    opencodeArgs: saved.opencodeArgs ?? '',
  }

  const argsByAgent = Object.fromEntries(
    AGENT_CLIS.map((cli) => {
      const value = getArgsForAgent(cli, base)
      // Resume flags are per-CLI: Claude takes --continue, Codex takes a `resume`
      // subcommand. ensureResumeArgs owns that difference.
      return [cli, resume ? ensureResumeArgs(cli, value) : value]
    }),
  ) as Record<AgentCli, string>

  return { agentCli, argsByAgent, rememberArgs: getArgsForAgent(agentCli, base) }
}

/**
 * Ids of the terminals that were minimized when the session was saved.
 *
 * `entries` must align 1:1 with `saved` — the caller builds it with `.map()`, so it does.
 * That is load-bearing and invisible: introduce a `filter` and minimized state silently
 * attaches to the wrong tiles rather than failing. The length check makes that a thrown
 * error at the call site instead of a mystery in the UI.
 */
export function minimizedIdsFromRestore(
  entries: Array<{ id: string }>,
  saved: SavedSessionProject[],
): string[] {
  if (entries.length !== saved.length) {
    throw new Error(
      `session restore: ${entries.length} entries for ${saved.length} saved projects — they must map 1:1`,
    )
  }
  return entries.filter((_, i) => saved[i]?.minimized).map((e) => e.id)
}
