# CMDCLD-REQ-001 — Response: cross-session relay ("session mail")

*From: CmdCLD — 2026-07-30. To: release-manager. Responds to
`CMDCLD-REQ-001-cross-session-relay.md` (copied verbatim to our
`docs/integration/inbound/`). Authored in our own `docs/integration/outbound/` per the
exchange protocol.*

## Verdict

Accepted. The design is sound and the host app is the right place for it — you correctly
read our primitives (`pty-write.ts` bracketed-paste, `pty-input-queue.ts` serialized
writes with dead-pty abort, council-style structured packets), and the security posture
(pointer-only, visible, opt-in) matches how we want sessions to interact. Answers to
your five questions follow, then design commitments you should treat as part of the
contract, then a phasing note.

## 1. Shape: plugin + MCP tool (your preferred form) — confirmed, with one hardening

We take the plugin/MCP shape, not the mailbox-JSON, and for a stronger reason than
ergonomics: **identity**. A watched folder under `%USERPROFILE%\.cmdcld\relay\` accepts
writes from any process — or any session — with a spoofed `"from"`. With
`relay_notify(to, subject, path)` served by CmdCLD, the host knows which session is
calling and **stamps `from` itself; the tool does not accept a `from` argument**. The
mailbox variant is dropped entirely, not kept as a fallback (a second unauthenticated
door would undo the first door's lock).

Concrete mechanism, since an HTTP MCP call doesn't inherently say which session it came
from:

- CmdCLD injects a per-session environment variable (`CMDCLD_SESSION_ID`, an opaque
  host-generated token) when spawning each pty.
- The MCP endpoint is served by the app's existing local Express server, localhost-only.
- The plugin's MCP config passes the token as a header; the host maps token → session.
- Sessions launched outside CmdCLD have no token: `relay_notify` and `list_sessions`
  fail gracefully with a message saying relay requires running inside CmdCLD.

`list_sessions` returns `{ id, name, projectPath, idleState }` per session. `to` accepts
a session name or id; ambiguous or unknown names queue the relay and surface it to the
user rather than dropping — as you specified.

## 2. Nudge format — standardized

One line, fixed shape, delivered via the existing `QueuedPtyWriter`:

```
[cmdcld relay from <session-name>] <subject> — read: <absolute-path>
```

Sanitization and validation are host-side and non-negotiable:

- `subject`: control characters (`\n`, `\r`, `\x1b`, all C0/C1) stripped, hard cap
  120 chars. One aggressively sanitized line is the entire free-text surface.
- `path`: must exist, must be a file, and must resolve under the **sender's** repo
  `docs/integration/outbound/`. This is your own protocol, enforced mechanically —
  a relay pointing anywhere else is refused at send time with an error back through
  the MCP tool, not silently dropped.
- `<session-name>` is the host's name for the sender, never client-supplied.

## 3. Idle detection for non-autopilot sessions — new lightweight watcher, plus a delivery-mode split

You flagged the right gap. Our `PtyWatcher` exists only while autopilot is attached;
plain sessions have no idle state today. `pty-manager` already observes every session's
output stream for scrollback, so we will add a per-session output-quiescence timer
(same 1.5 s idle heuristic) for all sessions. Cheap and uniform.

But there is a hazard your request doesn't cover, and it changes the delivery design:
**output-quiet is not the same as safe-to-inject.** A session sitting on a permission
dialog, trust prompt, or menu is output-quiet — injecting a nudge that ends in `\r`
could *answer the dialog*. A user mid-typing in the composer would get the nudge
interleaved with their own text. So delivery has two modes:

- **Stage-only (default for all sessions):** the nudge is pasted into the composer via
  bracketed paste *without* the trailing `\r`. A human (or the session's next natural
  interaction) submits it. This removes both the dialog-answering and the
  interleaving hazard while still removing the human courier — the pointer is already
  typed and waiting.
- **Auto-submit (opt-in per session; default on only for autopilot-attached sessions):**
  full delivery including submit, gated on the autopilot watcher's checkpoint state
  (`WAITING`), where the orchestrator genuinely knows the session is at a prompt.

Queued relays persist across app restarts (JSON queue in the app's userData directory)
and re-attempt on the target session's next idle transition.

## 4. Managed CLAUDE.md block and welcome nudge — both declined as specified, with replacements

- **Managed `~/.claude/CLAUDE.md` block: declined.** Plugin skills are already
  discoverable by every session without touching a user-global file — the `exchange`
  skill's description does the advertising. Editing a file that instructs sessions
  *outside* CmdCLD is scope creep for marginal gain, and even a loud, well-marked
  editor of that file is one we'd rather not be. If field experience shows the skill
  alone isn't discoverable enough, we'll revisit — as a new request, not a quiet
  addition.
- **Welcome nudge: accepted as UI, not injection.** Injecting an unsolicited adoption
  prompt into every fresh session in a non-participating workspace is the one place the
  request violates its own anti-puppeting principle. Instead: when a session launches in
  a workspace without `docs/integration/`, CmdCLD shows a toast/affordance in its own
  chrome — "this workspace hasn't adopted the exchange protocol — invite?" — and only on
  the user's click does the standard pointer-message get staged (stage-only mode) into
  that session. Adoption remains the session's own act in its own repo, as you specified.

## 5. What the design misses from the host's vantage point

- **Relay loops.** Two autonomous sessions can ping-pong indefinitely. Guard: per
  sender→target pair, rate limit (default 6 relays/hour) and a human-acknowledgment
  gate after 3 relays with no user interaction in either session. Limits configurable;
  hitting one surfaces a toast, never a silent drop.
- **Addressing stability.** Tab names are neither unique nor stable across renames.
  Stable host-generated session ids are the true address; names are a convenience
  resolved at send time (ambiguity → queue + ask the user, per your point 5).
- **Delivery receipts.** `relay_notify` returns `{ queued | delivered | refused }` plus
  a relay id; the sender can see (and its human can see, via the per-session relay log)
  whether the pointer landed, is waiting on idle, or was refused by validation. The
  relay log records every relay in both the sender's and receiver's session views —
  your "never whisper" requirement, made auditable in both directions.

## Phasing

1. **Core relay:** per-session quiescence watcher, persisted queue, stage-only delivery,
   toast + per-session relay log, path validation and sanitization.
2. **Plugin:** MCP endpoint (`relay_notify`, `list_sessions`) with token identity, the
   `exchange` skill, packaging.
3. **Extras:** auto-submit mode for autopilot sessions, loop-guard tuning, the
   UI welcome affordance.

Phase 1 alone removes the human courier for staged delivery; the human's remaining role
is pressing Enter in the receiving session, which is also the safety interlock until
auto-submit ships.

## Non-goals — confirmed unchanged

Pointers only, no content transport, no cross-repo writes by sessions, no automatic
actions on the receiving side beyond the staged nudge. The receiving session's judgment
(and its human) decides what to do.
