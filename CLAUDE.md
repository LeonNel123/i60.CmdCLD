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
    remote-server.ts     # Express + Socket.IO remote access
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

**Two channels**, by design redundant:

1. **File-based (primary, machine-readable):**
   - Doer writes `.autopilot/outbox/marker.json` (validated against schemaVersion 1 in `control-channel.ts`).
   - Orchestrator writes `.autopilot/inbox/reply.txt`.
   - Validation lives in `validateControlMarkerObject()` — `kind` mandatory; PROGRESS additionally requires `subgoalId` and `status ∈ {done, partial, blocked}`.
   - `reconcileMilestoneState(memory, disk)` merges disk-side subgoal status into memory.
2. **Terminal-visible (fallback, human-readable):** literal `[ORCH:KIND]` line followed by structured `KEY: value` lines (`STATUS`, `SUBGOAL`, `PROGRESS_STATUS`, `FILES_CHANGED`, `TESTS`, `RED_PHASE`, `BOUNDARY_OK`, `EVIDENCE`, `BLOCKER`, `QUESTION`).
   - Parsed by `MARKER_LINE_RE` in `pty-watcher.ts`.
   - The regex now tolerates leading shell prompt chars (`>|│┃║╎╏┆┇┊┋▌▍▎▏›❯•◦●○`).
   - **Beware:** the indent-tolerance also matches plain space-indented lines. `looksLikeIndentedProtocolExample()` only filters tails that contain `<…>` or em-dashes — see "Known issue" below.

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
- New code intended to live in the orchestrator goes in `src/main/autopilot/` (classic) or `src/main/autopilot-pro/` (PRO) — keep them separate.
- When changing the marker protocol, update **all four** of: `pty-watcher.ts` (parser), `control-channel.ts` (JSON schema), `prompts.ts` (doer contract), and `attach-session.ts` (bridge prompt examples). They drift easily.
- Don't add backwards-compat shims for marker schema changes — bump `schemaVersion` and reject old payloads.

## Bridge-prompt vs marker-parser disambiguation

The doer-marker parser (`parseTerminalMarkerLine` in `pty-watcher.ts`) intentionally tolerates plain whitespace-indented marker lines (commit `d67b2a3`) — some terminal renderings inject leading spaces. That tolerance can cause false positives when the bridge prompt's own example markers, or marker-shaped user answers, appear in scrollback.

Two source-side conventions in `attach-session.ts` keep the prompt out of the parser's mouth:

1. **Example markers carry a `<example>` tail** — `looksLikeIndentedProtocolExample()` rejects indented marker lines whose tail contains `<…>` or em-dashes.
2. **User-answer indent prefix is `# ` (not two spaces)** — the regex requires column-1 `[` or one of the explicit shell-prompt characters (`>|│┃║╎╏┆┇┊┋▌▍▎▏›❯•◦●○`); a `# ` prefix doesn't match either, so a user typing `[ORCH:GOAL_READY]` becomes `# [ORCH:GOAL_READY]` which is not a marker.

When changing the bridge prompt or `indentBlock`, keep both invariants — the regression tests in `tests/autopilot-attach-session.test.ts` ("keeps visible bridge marker examples hidden…" and "delimits marker-looking user answers…") will catch breakage.

## Skills

This repo benefits from `superpowers:test-driven-development`, `superpowers:systematic-debugging`, and `superpowers:verification-before-completion` for autopilot changes. UI work in `src/renderer/` can use `frontend-design` / `web-design-guidelines`.
