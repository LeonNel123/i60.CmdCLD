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
  customArgsFor,
  ensureResumeArgs,
  getArgsForAgent,
  normalizeAgentCli,
  type AgentArgsSettings,
  type AgentCli,
  type RememberedProjectAgent,
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
   * What to record for the folder — its CLI, plus its customised args if they are that
   * CLI's. Never the resume flags: `--continue` belongs to this restore, not to the
   * project, and remembering it would make every later open resume.
   */
  remember: RememberedProjectAgent
}

/**
 * Args come from the current settings, not from the saved session. The saved args are a
 * snapshot taken when the session was saved, and relaunching with them is how a change
 * to the agent settings (adding --continue, say) failed to reach every project that was
 * open at the time. A folder's own customised args, held in `projectAgents`, still win
 * for the CLI they were made for.
 */
export function resolveRestoredSession(
  saved: SavedSessionProject,
  resume: boolean,
  current: { argsSettings: AgentArgsSettings; remembered?: RememberedProjectAgent },
): RestoredSession {
  const agentCli = normalizeAgentCli(saved.agentCli)
  const custom = customArgsFor(current.remembered, agentCli)

  const argsByAgent = Object.fromEntries(
    AGENT_CLIS.map((cli) => {
      const value = (cli === agentCli ? custom : undefined) ?? getArgsForAgent(cli, current.argsSettings)
      // Resume flags are per-CLI: Claude takes --continue, Codex takes a `resume`
      // subcommand. ensureResumeArgs owns that difference.
      return [cli, resume ? ensureResumeArgs(cli, value) : value]
    }),
  ) as Record<AgentCli, string>

  // `!== undefined`, not truthiness: '' means the folder runs with no flags.
  return { agentCli, argsByAgent, remember: custom !== undefined ? { agentCli, customArgs: custom } : { agentCli } }
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
