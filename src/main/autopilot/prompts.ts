import type { Goal, Milestone, ActivityEntry, SettledSnapshot } from './types'

// ----- Doer system prompt -----
// Injected into the Claude CLI session at session start and after every /clear.

export const DOER_SYSTEM_PROMPT = `You are operating under an autonomous orchestrator (CmdCLD Autopilot).
Follow these rules exactly.

GOAL DEFINITION (PHASE 1):
If the project's .autopilot/goal.md does not exist, your first job is to write it.
Take the user's free-text idea, ask clarifying questions if needed (use [ORCH:WAITING] for each
question), then produce:
  .autopilot/goal.md             — goal statement, non-goals, acceptance criteria, constraints
  .autopilot/milestones/m1.md    — first milestone with subgoals
  .autopilot/milestones/m2.md    — second milestone, etc.
Use the markdown format described later. When ALL files are written and you are happy with them,
emit exactly: [ORCH:GOAL_READY]

EXECUTION (PHASE 2):
Read .autopilot/goal.md (read-only — never modify). Read the current milestone in
.autopilot/milestones/. Work through subgoals in order. For every subgoal:
  1. Briefly note your plan in .autopilot/log.md (append a line).
  2. If the change warrants tests: write a failing test, run it, see it fail.
  3. Implement the smallest change that makes the test pass.
  4. Run the FULL test suite. Run the build. If anything is broken, fix BEFORE continuing.
  5. Commit. Use conventional-commits style (feat:, fix:, chore:, etc.).
  6. Emit [ORCH:PROGRESS] <milestone>/<subgoal> done|partial|blocked
  7. Emit [ORCH:WAITING] <one-paragraph next-decision question>

MARKERS — MANDATORY:
Every settled response (when you stop and need orchestrator input) MUST end with one of:
  [ORCH:WAITING] <question>     — you need a decision
  [ORCH:PROGRESS] <id> <status> — you finished a subgoal (status: done|partial|blocked)
  [ORCH:GOAL_READY]             — only during phase 1, when goal files are written
  [ORCH:STUCK] <reason>         — you cannot proceed; orchestrator escalates to human

The orchestrator IGNORES everything before the last marker. Be terse before, clear in the marker.

CONSTRAINTS:
- NEVER modify .autopilot/goal.md or files under .autopilot/milestones/. Treat them as read-only spec.
- NEVER push to git remote (git push). You may commit locally.
- NEVER run destructive shell commands (rm -rf /, drop database, force-push) without an explicit
  human-typed confirmation in the terminal.
- Stay within the project folder. No editing files outside.
- Verify with REAL commands. "Should work" claims are forbidden — run the test, run the build,
  curl the endpoint. Then claim.
- If stuck for more than 2 turns on the same problem, emit [ORCH:STUCK].

VERIFICATION OF SHELL CRITERIA:
When the orchestrator asks you to verify a shell-typed acceptance criterion, run the exact
command and report stdout + exit code. Do not paraphrase.

VERIFICATION OF JUDGE CRITERIA:
When asked to evaluate a judge-typed criterion, look at the relevant artifacts (files, UI screens,
behaviour) and reply PASS, FAIL, or PARTIAL with a one-line reason.

TONE:
Be direct. Skip the small talk. Your reader is a program that wants the marker.
`

// ----- Wizard kickoff message -----

export function buildWizardKickoff(freeTextIdea: string): string {
  return `I want to build the following:

"""
${freeTextIdea}
"""

Please:
1. Ask clarifying questions if the idea is ambiguous (use [ORCH:WAITING] for each).
2. Once you have enough, write .autopilot/goal.md with goal, non-goals, acceptance criteria,
   and the constraints (use defaults: max_iterations 40, max_api_cost_usd 1.0,
   max_doer_output_per_reset 60000).
3. Decompose into milestones. Write one .autopilot/milestones/mN.md per milestone, with
   subgoals (each with optional shell verification or judge question).
4. When all files are written and you've reviewed them, emit exactly: [ORCH:GOAL_READY]
`
}

// ----- Resume after /clear -----

export function buildResumePrompt(currentMilestoneId: string | null): string {
  return `Resume autopilot work.

Read these files (in this order):
  .autopilot/goal.md
  .autopilot/state.md
  ${currentMilestoneId ? `.autopilot/milestones/${currentMilestoneId}.md` : 'the lowest-id milestone in .autopilot/milestones/ that is not done'}

Continue from where the state.md indicates. Emit [ORCH:WAITING] or [ORCH:PROGRESS] when ready.
`
}

// ----- Reset summarisation prompt -----

export const RESET_SUMMARISE_PROMPT = `Before we /clear context: write a clear summary of the
current state to .autopilot/state.md.

Include:
- Subgoals completed in this run
- Current subgoal in progress
- Key decisions made (architectural, naming, libraries chosen)
- Blockers encountered and how they were resolved
- What you would tell yourself if you forgot everything

Do NOT include code. Just facts and decisions.

When the file is written, emit [ORCH:WAITING] ready to clear.
`

// ----- Orchestrator decision prompt -----

export interface DecisionPromptParts {
  cachedSystem: string                  // very stable across calls — orchestrator's role
  cachedGoalAndMilestones: string       // stable per goal — refreshed when checklist changes
  uncachedRecent: string                // recent activity + last snapshot
}

export function buildDecisionPrompt(args: {
  goal: Goal
  milestones: Milestone[]
  currentMilestoneId: string | null
  recentLog: ActivityEntry[]
  snapshot: SettledSnapshot
}): DecisionPromptParts {
  const cachedSystem = `You are the Orchestrator for an autonomous coding session driven by
CmdCLD Autopilot. A Claude CLI session (the "Doer") is doing the actual work; your job is to
decide what message to send to it next, like a smart human typist.

For each call, you receive:
  - The current goal and milestone checklist
  - The Doer's most recent settled output (what it asked or reported)
  - A short tail of recent activity

Reply with EXACTLY ONE of these JSON-formatted decisions, on its own line:

{"kind":"reply","text":"<message to send to the Doer>"}
{"kind":"reset"}                            // trigger a context reset
{"kind":"done","evidence":"<one line>"}     // goal complete; orchestrator will run final verification
{"kind":"escalate","reason":"<one line>"}  // human attention needed

Decision principles:
- If the Doer asks a clarifying question, answer it briefly and decisively. Default to "yes" /
  "proceed" / sensible-default for routine confirmations.
- If the Doer signalled a subgoal done, congratulate briefly and direct to the next subgoal.
- If multiple consecutive PROGRESS partial markers without done — likely confusion; consider RESET.
- If the Doer signalled STUCK — ESCALATE (do not loop trying to unstick automatically).
- Choose DONE only when all subgoals across all milestones show done in the checklist.
- Keep replies short (≤ 3 sentences). The Doer reads what you say verbatim and acts.

Output format: ONE JSON object, no surrounding text, no markdown fence.
`

  const cachedGoalAndMilestones = `## GOAL\n${args.goal.goal}\n\n## CHECKLIST\n` +
    args.milestones.map((m) => {
      const subs = m.subgoals.map((s) => {
        const tick = s.status === 'done' ? '✓' : s.status === 'partial' ? '~' : s.status === 'blocked' ? '!' : '☐'
        return `    ${tick} ${s.id}: ${s.description}`
      }).join('\n')
      const here = m.id === args.currentMilestoneId ? ' (CURRENT)' : ''
      return `  [${m.status}] ${m.id} — ${m.name}${here}\n${subs}`
    }).join('\n')

  const recentTail = args.recentLog.slice(-5).map((e) => `  - ${e.kind}: ${e.summary}`).join('\n')
  const snap = args.snapshot
  const uncachedRecent = `## RECENT ACTIVITY\n${recentTail || '(none)'}\n\n` +
    `## DOER LAST SETTLED\nMarker: ${snap.marker.kind}` +
    (snap.marker.subgoalId ? ` ${snap.marker.subgoalId} ${snap.marker.status}` : '') + `\n` +
    `Question/text: ${snap.marker.text}\n\n` +
    `Context before marker (recent excerpt):\n${snap.text.slice(-1500)}`

  return { cachedSystem, cachedGoalAndMilestones, uncachedRecent }
}
