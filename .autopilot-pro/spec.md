# Spec

## Goal

Marker-shaped text that appears in terminal scrollback without being a marker the doer
actually emitted must stop driving the orchestrator. Today `findLastMarker` in
`src/main/autopilot/pty-watcher.ts` scans the settled buffer line by line and accepts the
last line that matches `MARKER_LINE_RE`, with one prose heuristic
(`looksLikeIndentedProtocolExample`) rejecting an indented line only when its tail contains
`<...>` or an em-dash. Anything else marker-shaped in the buffer — the orchestrator's own
missing-marker nudge echoed back, a marker quoted inside a fenced code block, a protocol
line the agent prints while explaining itself — parses as a real marker and settles a
cycle. The fix adds buffer-context discrimination at the `findLastMarker` level, where the
surrounding lines are visible, and leaves the line-level parser's contract untouched.

## Non-goals

- No change to the file-based control channel (`outbox/marker.json`, `inbox/reply.txt`) or
  to any control-channel JSON schema; `schemaVersion` stays 1.
- No new marker kinds, no new structured keys, no change to the doer contract in
  `prompts.ts` beyond what a parser rule makes newly wrong to write.
- No UI or renderer work.
- No changes under `src/main/autopilot-council/`.
- No attempt to distinguish a genuine doer marker from a byte-identical line typed by a
  user at the same terminal with no surrounding context — see Constraints.

## Acceptance

- judge: WHEN the settled buffer contains a marker-shaped line inside a fenced code block
  (``` or ~~~), THE SYSTEM SHALL NOT return it from `findLastMarker`.
- judge: WHEN a line contains two or more `[ORCH:*]` tokens — the shape of the
  orchestrator's own nudge and of any protocol enumeration — THE SYSTEM SHALL NOT treat it
  as a marker, at either `findLastMarker` or `recoverLiteralMarkerFromTail`.
- judge: WHEN a marker-shaped line is preceded on the same line by prose, a quote
  character, or a comment marker, THE SYSTEM SHALL NOT treat it as a marker.
- judge: WHEN the agent prints the protocol while explaining it (a marker line whose tail
  is documentation: placeholders in angle brackets, `|`-separated alternatives, or an
  imperative such as "emit"/"please"), THE SYSTEM SHALL NOT treat it as a marker.
- judge: WHEN an indented marker example from the attach bridge prompt appears in
  scrollback, THE SYSTEM SHALL NOT treat it as a marker — the behaviour
  `tests/autopilot-attach-session.test.ts` already pins, preserved.
- judge: WHEN the doer emits a genuine marker — at column 1, behind a shell-prompt glyph
  (`>` `|` `│` `┃` `║` `›` `❯` `•` `◦` `●` `○` and the box-drawing set), or plain
  space-indented as some renderers produce — THE SYSTEM SHALL parse it exactly as it does
  today, including its structured block.
- judge: WHEN a suppression rule fires, THE SYSTEM SHALL keep scanning older lines rather
  than abandoning the buffer, so a real marker above the noise is still found.
- shell: `npx vitest run tests/autopilot-pty-watcher.test.ts tests/autopilot-attach-session.test.ts`
  — passes with every pre-existing assertion in those two files unmodified.
- shell: `npm test` — green at the end of every phase.
- shell: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`

## Constraints

- `parseTerminalMarkerLine` keeps its current line-level contract. Two pinned tests fix it
  in place: `'  [ORCH:GOAL_READY]'` and `'  [ORCH:WAITING] continue?'` must both still
  parse, and `'> [ORCH:WAITING] ready?'` with them. A bare indented marker with a plain
  tail is therefore indistinguishable from a user typing the same characters, and no
  line-level rule can separate them. Context rules go where context exists: in
  `findLastMarker`, which sees the whole buffer, and in `recoverLiteralMarkerFromTail`,
  which sees the tail. The bridge prompt's existing `# ` answer-prefix convention
  (CLAUDE.md, "Bridge-prompt vs marker-parser disambiguation") remains the mechanism for
  user-typed marker text, and stays intact.
- Suppression must never strand a run: rejecting a line means continuing the scan, not
  returning null for the buffer.
- Every marker-protocol change lands in all of the places CLAUDE.md lists, or is
  explicitly recorded as not needing to. This change is parser-side only: no schema, so
  `control-channel.ts` and `autopilot-shared/control-channel.ts` are untouched by design,
  and `prompts.ts` changes only if a new rule would make an existing documented example
  unparseable.
- No backwards-compat shims. If a schema change becomes necessary, bump `schemaVersion`
  and reject old payloads rather than accepting both.
- TDD: each rule gets a test that fails first against the current parser.
- Work on branch `autopilot-pro/marker-parser-hardening` off master. Local commits only,
  never push.

## Repository impact

- `src/main/autopilot/pty-watcher.ts`: add buffer-context suppression to `findLastMarker`
  (fenced-code tracking, multi-token lines, prose-prefixed lines) and share the
  documentation-tail test with `recoverLiteralMarkerFromTail`; `parseTerminalMarkerLine`
  and `MARKER_LINE_RE` unchanged.
- `tests/autopilot-pty-watcher.test.ts`: add a failing-first case per acceptance rule
  alongside the existing 36 tests, none of which change.
- `tests/autopilot-attach-session.test.ts`: unchanged — read as the contract for the two
  bridge-prompt invariants; touched only if a new rule provably supersedes one.
- `src/main/autopilot/output-inspector.ts`: calls `parseTerminalMarkerLine` per line at
  lines 40 and 47 and `findLastMarker` at line 61 to build the operator's output preview;
  verify the preview still locates the marker it displays.
- `src/main/autopilot-pro/state-machine.ts`: imports `findLastMarker`,
  `parseTerminalMarkerLine`, `splitTerminalLines`, `stripTerminalAnsi` (line 17) and
  re-exports `findLastMarker` (line 1481); PRO inherits the new behaviour with no edit
  expected — confirmed by its own suite rather than assumed.
- `src/main/autopilot/state-machine.ts`: uses `recoverLiteralMarkerFromTail` in the
  missed-marker path (lines 703, 746); behaviour must not regress.
- `CLAUDE.md`: the "Known issue" note under "Bridge-prompt vs marker-parser
  disambiguation" describes the heuristic being replaced and is updated to match.
