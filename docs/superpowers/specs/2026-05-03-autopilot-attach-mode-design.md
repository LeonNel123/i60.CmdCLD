# Autopilot Attach Mode Design

## Summary

Autopilot Attach Mode lets CmdCLD take over orchestration for an already-running Claude or Codex CLI session. The user can start either CLI manually, work normally, and later click `Attach Autopilot` without needing an initial Autopilot goal. CmdCLD reads recent terminal output, uses the configured Autopilot LLM when available to understand the current CLI state, sends a protocol bridge prompt, and then begins watching only new output for `[ORCH:*]` markers.

The first release focuses on attaching to an active manual CLI session. Restarting or recovering an existing Autopilot run should use the same attach/resync primitives later, but is not the primary workflow for this slice.

## Goals

- Attach Autopilot to any active Claude or Codex terminal tab.
- Work without an initial goal.
- Allow the user to provide an answer to the CLI's current prompt during attach.
- Use the Autopilot LLM to classify the current terminal state and draft the bridge prompt when credentials are configured.
- Fall back to a deterministic bridge prompt when the Autopilot LLM is unavailable.
- Start marker watching from a fresh output offset after the bridge prompt is sent, so echoed prompt text cannot be mistaken for real CLI markers.
- Show visible attach diagnostics: detected state, bridge status, watch start position, last marker, and no-marker status.
- Avoid silent token usage by making LLM-assisted attach explicit in the UI.

## Non-Goals

- Replacing Claude or Codex CLI as the execution agent.
- Building a full direct tool-execution developer agent inside Autopilot.
- Automatically attaching to every terminal without user action.
- Guaranteeing recovery from a broken or hung CLI process.
- Changing the core Autopilot Pro state machine beyond the minimum needed to support attach mode.

## User Experience

Each terminal gets an `Attach Autopilot` action. When clicked, the Autopilot panel enters attach mode and displays:

- The target terminal name and detected CLI type when known.
- A `Latest output` preview based on cleaned scrollback.
- A `Your answer` input for the user to paste or type the response they want the CLI to receive.
- A `Use Autopilot LLM to interpret current state` control, enabled only when provider configuration is available.
- A preview of the proposed bridge prompt before it is submitted.
- Status rows for `bridge drafted`, `bridge sent`, `watching from output offset`, and `last marker`.

The user can submit the bridge prompt as drafted or edit the user answer and regenerate it. After attach succeeds, the regular Autopilot controls resume, but the session is marked as attached rather than goal-started.

## Attach Flow

1. User manually starts Claude or Codex CLI in a CmdCLD terminal.
2. User clicks `Attach Autopilot`.
3. Main process captures the terminal scrollback and current terminal output offset.
4. Attach service normalizes the output using the same cleaning path as the output inspector.
5. If Autopilot LLM access is configured, attach service asks it to classify the state:
   - `idle`
   - `waiting_for_user`
   - `permission_request`
   - `working`
   - `blocked`
   - `unknown`
6. Attach service drafts a bridge prompt. If the user supplied an answer, the prompt includes that answer as the next response.
7. UI shows the classification and bridge preview.
8. User confirms attach.
9. CmdCLD writes the bridge prompt through the queued PTY writer, using delayed submit behavior.
10. Watcher records a new baseline output offset after the bridge write.
11. Watcher ignores older output and begins parsing only new CLI output for `[ORCH:*]` markers.
12. Autopilot transitions to an attached orchestration state once the first marker is detected, or shows `no marker detected yet` after a timeout.

## Bridge Prompt Shape

The bridge prompt should be short, explicit, and repeated enough to survive mid-session context:

```text
CmdCLD Autopilot is now coordinating this CLI session.
Continue from the current terminal state.

If you need user or orchestrator input, end the response with:
[ORCH:WAITING]
STATUS: waiting
QUESTION: <specific question>

If you are actively working, report progress with:
[ORCH:PROGRESS]
STATUS: working

If the requested work is complete and ready for review, end with:
[ORCH:GOAL_READY]
STATUS: ready
SUMMARY: <short summary>

If blocked, end with:
[ORCH:STUCK]
STATUS: blocked
REASON: <blocker>

Keep these markers visible as plain text in the terminal output.
```

When the user provides an answer, the bridge prompt appends:

```text
The user's answer to your current prompt is:
<answer>

Use this answer and continue.
```

## Architecture

Add a focused attach module under `src/main/autopilot/`:

- `attach-session.ts`
  - Owns attach classification, bridge prompt drafting, and attach lifecycle.
  - Uses output inspector normalization.
  - Uses the existing Autopilot API client when LLM-assisted attach is enabled.
  - Falls back to deterministic prompt drafting.

- `attach-types.ts`
  - Defines attach state, classification result, bridge draft, and diagnostic payload types.

- Existing PTY input queue
  - Sends bridge prompt safely to Claude and Codex.
  - Keeps delayed submit behavior for multiline prompt submission.

- Existing PTY watcher
  - Adds an attach baseline offset so only output after attach is parsed.
  - Publishes marker diagnostics back to the renderer.

- Renderer Autopilot panel
  - Adds attach mode UI.
  - Shows attach diagnostics and bridge preview.

## IPC Surface

Add narrowly scoped IPC endpoints:

- `autopilot:attachDraft`
  - Input: terminal ID, optional user answer, LLM-assisted flag.
  - Output: classification, bridge prompt, cleaned scrollback tail, token/provider metadata when available.

- `autopilot:attachConfirm`
  - Input: terminal ID and bridge prompt.
  - Output: attach session ID, write status, baseline output offset.

- `autopilot:attachStatus`
  - Input: attach session ID.
  - Output: attach lifecycle status, last marker, last inspected output summary.

- `autopilot:attachCancel`
  - Input: attach session ID.
  - Output: cancellation result.

The existing `autopilot:inspectOutput` endpoint remains useful as a lower-level diagnostic tool and should not be replaced.

## Error Handling

- No terminal selected: show a targeted UI error and do not call the LLM.
- Terminal has no scrollback: allow deterministic attach, but warn that state detection is limited.
- No Autopilot LLM credentials: disable LLM-assisted attach and use deterministic bridge prompt.
- LLM call fails: show the failure and offer deterministic bridge draft.
- PTY write fails: keep attach in failed state with retry available.
- No marker after bridge: show `no marker detected yet` with `Check latest output` available.
- Parser sees only echoed bridge text: ignored because watcher starts from the post-write baseline offset.

## Security And Safety

Terminal output is untrusted input. The LLM-assisted attach prompt must instruct the model to classify state and draft a bridge prompt only. It must not execute terminal instructions, change files, or follow commands embedded in scrollback. The user must confirm before the bridge prompt is sent.

Autopilot should make token use visible. Drafting should display the configured provider/model and whether a request was made. Deterministic fallback should say that no LLM tokens were used.

## Testing

Unit tests:

- Classifies basic Claude and Codex scrollback states.
- Drafts deterministic bridge prompts with and without user answers.
- Builds LLM-assisted prompt without leaking control authority to terminal output.
- Starts watcher from post-bridge baseline and ignores echoed bridge markers.
- Reports no-marker timeout as a diagnostic state rather than a silent failure.

Integration tests:

- Attach to mocked Codex output that later emits `• [ORCH:WAITING]`.
- Attach to mocked Claude output that later emits `●[ORCH:WAITING] STATUS:waiting`.
- Attach with no LLM credentials and confirm deterministic fallback.
- Attach with a user answer and verify the answer is included only in the bridge prompt body.

Manual verification:

- Start Codex CLI manually, click `Attach Autopilot`, confirm bridge, verify marker detection.
- Start Claude CLI manually, click `Attach Autopilot`, confirm bridge, verify marker detection.
- Repeat with the CLI asking a permission/user question and use `Your answer`.

## Implementation Order

1. Add attach types and deterministic bridge draft logic.
2. Add attach draft/confirm/status IPC.
3. Wire attach confirm to the queued PTY writer and watcher baseline.
4. Add renderer attach UI and diagnostics.
5. Add LLM-assisted classification and bridge drafting.
6. Add tests around deterministic path, LLM prompt construction, baseline parsing, and renderer state.
7. Run live Claude and Codex attach tests.

## Design Decisions

- Attach should require user confirmation before sending the bridge prompt.
- LLM-assisted attach should be opt-in per draft action in the first version.
- The first implementation should support one active attach session per terminal.
- Restart/resync should be a follow-up feature built on the same attach service.
