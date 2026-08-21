# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project

CmdCLD — Electron desktop app that runs many Claude Code / Codex CLI sessions side-by-side in a grid, with sidebar navigation, paste-image, remote access (Express + Socket.IO), and an **Autopilot** orchestrator that drives a CLI agent through a goal end-to-end.

- Stack: Electron 33, React 18, xterm.js 5, node-pty, sql.js, marked.
- Build: `electron-vite`. Tests: `vitest`. Package: `electron-builder`.

## Commands

- `npm run dev` — start the app in dev (electron-vite).
- `npm run build` — build main/preload/renderer.
- `npm test` — run vitest once. `npm run test:watch` — watch mode.
- `npm run package:win|:mac|:linux` — produce installers.
- `npm run release:win` — bumps patch, builds, runs `version:check`.

## Layout

```
src/
  main/                  # Electron main process
    index.ts             # IPC handlers, window/lifecycle
    pty-manager.ts       # node-pty wrapping + scrollback
    store.ts, recent-db.ts, settings.ts, window-registry.ts
    remote-server.ts     # Express + Socket.IO remote access (loopback-bound; Host/Origin gate in remote-guard.ts; LAN via remoteLanAccess setting)
    autopilot/           # Classic autopilot orchestrator (see below)
    autopilot-pro/       # PRO orchestrator (Wave 3.0 stage-based)
    autopilot-council/   # (auxiliary; left untouched in current change set)
  preload/index.ts       # contextBridge IPC surface
  renderer/src/          # React UI (TerminalPanel, Sidebar, AutopilotPanel, …)
  shared/                # cross-process types / agent-cli model
  remote-ui/             # browser dashboard served by remote-server
tests/                   # vitest unit tests
```

## Autopilot architecture

There are **two independent orchestrators** that share marker types but not state machines:

### Classic Autopilot — `src/main/autopilot/`

Goal-driven loop: wizard (define goal) → executing (milestone-by-subgoal) → completion / paused / escalated / stopped.

Key files:
- `state-machine.ts` — `AutopilotStateMachine`, central orchestrator class. Owns `state`, `cost`, `watcher`, control-channel polling, silence timer, reset bookkeeping.
- `pty-watcher.ts` — `PtyWatcher` (terminal I/O + ANSI strip + marker parser), `parseTerminalMarkerLine`, `recoverLiteralMarkerFromTail`.
- `control-channel.ts` — file-based marker channel (see below).
- `prompts.ts` — `buildDoerSystemPrompt`, `buildWizardKickoff`, `buildExecutionKickoff`. Defines the **doer contract** (markers + JSON schema).
- `state-files.ts` — `.autopilot/` on-disk state: `goal.md`, `milestones/*.md`, `state.md`, `log.md`, `learnings.md`, `transcript.jsonl`, `debug.jsonl`.
- `decision.ts` — `decide()` LLM call.
- `reset.ts` — `runResetSequence()` (clear and re-bootstrap doer context).
- `pty-input-queue.ts` — serialised writes into PTY.
- `attach-session.ts` — `buildAttachBridgePrompt`, deterministic attach drafts.
- `cost-tracker.ts`, `budget-tracker.ts`, `runtime-state.ts`, `validation.ts`, `output-inspector.ts`, `probe-artifacts.ts`, `corrupt-backup.ts`.

### Autopilot PRO — `src/main/autopilot-pro/`

Stage-based pipeline (research → discovery → planning → implementation → phase-review → final-review → done) with shape-driven decisions (`reply | choose | approve | route | validate | transition | decide-with-rationale | research`). Coexists with classic; does not replace it.

Key files: `state-machine.ts`, `prompts.ts`, `phases.ts`, `adr.ts`, `artifacts.ts`, `decision.ts`, `meta.ts`, `research-signals.ts`, `research-summary.ts`, `runtime-state.ts`.

### Marker protocol (shared)

Doer emits `DoerMarker` events of kind `WAITING | PROGRESS | GOAL_READY | STUCK`.

**Two channels per orchestrator**, by design redundant:

1. **File-based (primary, machine-readable):**
   - Doer writes `<dir>/outbox/marker.json` (validated against schemaVersion 1).
   - Orchestrator writes `<dir>/inbox/reply.txt`.
   - Per-orchestrator dirs: `.autopilot/` (Classic), `.autopilot-pro/` (PRO), `.autopilot-council/` (Council).
   - Shared IO + base-field validator: `src/main/autopilot-shared/control-channel.ts` — `makeControlChannel({ dir, validateExtra })`. Base validation enforces `schemaVersion === 1`, mandatory `kind`, and PROGRESS-requires-subgoalId+status.
   - Per-orchestrator wrappers: `src/main/autopilot/control-channel.ts`, `src/main/autopilot-pro/control-channel.ts`, `src/main/autopilot-council/control-channel.ts`. Classic also owns `reconcileMilestoneState` (memory ↔ disk subgoal status reconciliation).
   - PRO and Council schemas are strict supersets of Classic — they additionally validate `shape`, `proStatus`, `artifactPath`, `options`, `assumption`, `delta`, `optionsRationale`, `researchTopics`, `researchTopic`, `researchForce`, `subagentEtaMin`. Council reuses PRO's validator verbatim — only the dir differs.
   - Each state machine polls its own outbox at 1 Hz (`startControlWatchdog` / `pollControlChannel`). When a file marker arrives, `markerSignature` + a 2 s window suppresses the duplicate terminal echo via the dedupe block at the top of `onSettled`.
   - The PRO doer prompt is parameterised by `controlDir` (`buildDoerSystemPromptPro(agentCli, { controlDir })`); Council passes `.autopilot-council` to reuse the same prompt body.
2. **Terminal-visible (fallback, human-readable):** literal `[ORCH:KIND]` line followed by structured `KEY: value` lines (`STATUS`, `SUBGOAL`, `PROGRESS_STATUS`, `FILES_CHANGED`, `TESTS`, `RED_PHASE`, `BOUNDARY_OK`, `EVIDENCE`, `BLOCKER`, `QUESTION`, plus PRO's `DECISION_SHAPE`, `ARTIFACT`, `OPTIONS`, …).
   - Parsed by `MARKER_LINE_RE` in `pty-watcher.ts`.
   - The regex now tolerates leading shell prompt chars (`>|│┃║╎╏┆┇┊┋▌▍▎▏›❯•◦●○`).
   - Shape is decided per line (`parseTerminalMarkerLine`); whether a marker-shaped line is *genuine* is decided per buffer (`findLastMarker`) — see "Bridge-prompt vs marker-parser disambiguation" below.

### Reset semantics (recent change)

- Default output threshold raised from 60 KB → **180 KB** (`prompts.ts`, `state-files.ts`, `state-machine.ts:475`).
- Reset only fires at `WAITING` checkpoints during the **executing** phase (`shouldResetAtWaitingCheckpoint()`), never on `PROGRESS`.
- Rationale (commit `a69e9af`): give the doer more breathing room; avoid stomping mid-task context.

### Missed-marker recovery (recent change)

In `state-machine.ts handleMissingMarker()`:
1. If in **wizard** phase and `.autopilot/` files parse cleanly → synthesise `GOAL_READY` (prevents the wizard reset loop, commit `c7b333b`).
2. Else try `recoverLiteralMarkerFromTail()` — deterministic regex scan of cleaned terminal tail (commit `7b0e584`).
3. Else fall back to LLM adjudication via `api.chat()` (cost is tracked).
4. Escalate after `MAX_GOAL_READY_REPAIR_PROMPTS` (2) failed nudges.

### IPC surface (Classic, in `src/main/index.ts`)

`autopilot:start | pause | resume | stop | approveGoal | replyToWaiting | permissionAllow | permissionDeny | getStatus | inspectOutput | probeArtifacts | attachDraft | attachConfirm | attachStatus | attachCancel | keyExists | keySet | keyClear`. Renderer subscribes to `autopilot:update` for state pushes. PRO equivalents under `autopilot-pro:*`.

`replyToWaiting` is now async and returns `{ ok, error? }`; `AutopilotPanel.tsx` surfaces `manualReplyError` instead of failing silently.

## Working in this repo

- **Always run `npm test`** after touching anything in `src/main/autopilot*/` or `tests/autopilot-*`. The marker regex and state machine are heavily tested and easy to break in subtle ways.
- The Windows checkout has CRLF line endings; git will warn `LF will be replaced by CRLF` — this is expected, not a bug to fix.
- New code intended to live in the orchestrator goes in `src/main/autopilot/` (classic), `src/main/autopilot-pro/` (PRO), or `src/main/autopilot-council/` (Council) — keep them separate.
- When changing the marker protocol, update **all** of: `pty-watcher.ts` (parser), the relevant per-orchestrator `control-channel.ts` (JSON schema) plus `autopilot-shared/control-channel.ts` if the change is base-level, the relevant `prompts.ts` (doer contract), and `attach-session.ts` (bridge prompt examples for Classic). They drift easily.
- Don't add backwards-compat shims for marker schema changes — bump `schemaVersion` and reject old payloads.

## Lifecycle exits: teardown tracks recoverability

Every orchestrator holds four things while it runs: the pty listener (`detachPty`), the
control-channel watchdog (1 Hz), the silence timer, and `PtyWatcher`'s own timers — idle,
force-settle and the 30 s missing-marker fallback. The watcher's timers are its own;
detaching from pty data does not cancel them, which is why `watcher.reset()` is part of
teardown and not an optimisation.

The rule that decides what an exit must release:

> **If `resume()` will not bring the run back, the exit releases everything.**
> If it will, the exit keeps the listener and clears only the silence timer.

| Exit | `resume()` accepts it? | Releases |
|---|---|---|
| `pause` (classic, PRO) | yes | silence timer only |
| Council `pause` / `blocked` | yes | watcher + reviewer + watchdog; listener kept |
| `stop` (all three) | no | everything |
| PRO `finishRun` (stage → done) | no | everything |
| PRO `blocked` (cost cap, silence, unsupported prompt) | **no** | everything |
| Classic `completed` / `escalated` / `stopped` | **no** | everything |

Note that Council's `blocked` is recoverable and PRO's is not — same word, opposite
teardown. Check `resume()` before assuming.

Four bugs in this family have been fixed, all with the same shape — a state the machine
can enter and not leave:

- `8762399` — stage `done` never stopped the loop; each further marker walked the run back
  into final-review.
- `339b005` — teardown left the watcher armed, so a finished run nudged its terminal up to
  30 s later; `handleMissingMarker` was also the one pty entry point with no
  `canProcessPty()` guard, and in classic that path can reach a paid LLM call.
- `8aa67ae` — `advance` at `final-review` was a no-op, because `maybeAdvanceStage` has no
  edge out of that stage.
- `9f6a492` — phase completion read only `- [x]` in plan.md, which nothing writes, so
  Stage 3 never fired at all.

When adding a lifecycle exit or a timer, put it in the table above and in
`releaseRunResources()`. Both state machines route every one-way exit through that one
method so the list cannot drift per-exit again.

## Bridge-prompt vs marker-parser disambiguation

The doer-marker parser (`parseTerminalMarkerLine` in `pty-watcher.ts`) intentionally tolerates plain whitespace-indented marker lines (commit `d67b2a3`) — some terminal renderings inject leading spaces. That tolerance means a marker-shaped line is not, on its own, evidence that the doer emitted one: the bridge prompt's examples, a marker quoted in prose, and the orchestrator's own missing-marker nudge all reach scrollback looking identical to the real thing.

**The split that makes this tractable:** a single line carries enough information to decide *shape*, and not enough to decide *provenance*. So `parseTerminalMarkerLine` answers "is this marker-shaped?" and its contract is pinned by unit tests (`'  [ORCH:GOAL_READY]'`, `'  [ORCH:WAITING] continue?'` and `'> [ORCH:WAITING] ready?'` all parse). `findLastMarker` answers "did the doer emit this?", because it sees the whole buffer. Put new rules in the second one; changing the first breaks pinned tests, and it is shared with `output-inspector.ts`.

Rules `findLastMarker` applies while scanning back, each skipping the line and continuing rather than abandoning the buffer:

1. **Fenced ranges** — a marker inside a balanced ``` or `~~~` block is documentation. Unbalanced fences are deliberately ignored: only `emitSettle` clears the buffer, so an unclosed fence would hide the doer's own marker permanently and strand the run behind two nudges.
2. **Multi-token lines** — a line carrying two or more `[ORCH:*]` tokens is the protocol being described, not used. This is what the missing-marker nudge looks like once terminal chrome puts a prompt glyph in front of it; before the rule, a genuine marker directly above it lost the reverse scan and the orchestrator read its own question back as the answer. Shared with `recoverLiteralMarkerFromTail`.
3. **Documentation tails** — `looksLikeDocumentationTail()`: an angle-bracket placeholder, an `a|b|c` alternatives list, or an elided-subject imperative (`please emit`). Keep this clause minimal. Word-level rules on free text are where this parser keeps going wrong — a bare `please` clause rejected `[ORCH:WAITING] review please` and took four PRO state-machine tests with it; `emit the` then rejected `should I emit the commit now?`. The structural rules above are the reliable ones.

`findLastMarker` returns the `lineIndex` it used. A marker's raw text cannot identify its line — a quoted copy is byte-identical — so callers that need the structured block must take the index rather than search for the text. `output-inspector.ts` did the latter and reported an empty field set for a marker that had one.

Two source-side conventions in `attach-session.ts` still matter:

1. **Example markers carry a `<example>` tail** — caught by the angle-bracket clause of `looksLikeDocumentationTail()`.
2. **User-answer indent prefix is `# ` (not two spaces)** — the regex requires column-1 `[` or one of the explicit shell-prompt characters (`>|│┃║╎╏┆┇┊┋▌▍▎▏›❯•◦●○`); a `# ` prefix doesn't match either, so a user typing `[ORCH:GOAL_READY]` becomes `# [ORCH:GOAL_READY]` which is not a marker. This remains the only defence for a user typing a bare marker with no surrounding context — no in-band rule can separate that from the genuine article.

When changing the bridge prompt or `indentBlock`, keep both invariants — the regression tests in `tests/autopilot-attach-session.test.ts` ("keeps visible bridge marker examples hidden…" and "delimits marker-looking user answers…") will catch breakage.

Known limitation: `PtyWatcher.checkSettled` still locates the settle boundary with `cleaned.lastIndexOf(found.marker.raw)`, so a byte-identical quoted copy sends it to the wrong line. Measured consequence is that the cycle settles via the force-settle window instead of on idle — latency, not correctness.

## Skills

This repo benefits from `superpowers:test-driven-development`, `superpowers:systematic-debugging`, and `superpowers:verification-before-completion` for autopilot changes. UI work in `src/renderer/` can use `frontend-design` / `web-design-guidelines`.
