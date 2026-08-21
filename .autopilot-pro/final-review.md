# Final review — marker-parser hardening

Branch `autopilot-pro/marker-parser-hardening`, six commits off master at `8762399`.
Nothing pushed.

## What shipped

Marker-shaped text that the doer did not emit can no longer settle a cycle. The change
rests on one distinction: **a single line carries enough information to decide shape, and
not enough to decide provenance.** So `parseTerminalMarkerLine` keeps answering "is this
marker-shaped?" — its contract untouched, its unit tests unmodified — and `findLastMarker`,
which sees the whole buffer, answers "did the doer emit this?".

Three rules, each skipping the line and continuing the scan rather than abandoning the
buffer:

| Rule | Rejects | Shared with recovery path |
|---|---|---|
| Fenced ranges | a marker inside a balanced ``` or `~~~` block | no |
| Multi-token lines | a line naming two or more `[ORCH:*]` kinds | yes |
| Documentation tails | `<placeholder>`, `a\|b\|c` lists, `please emit` | via the line parser |

`findLastMarker` also returns the `lineIndex` it used, because a marker's raw text cannot
identify its line — a quoted copy is byte-identical.

## Acceptance, criterion by criterion

| spec.md acceptance | Where it is decided |
|---|---|
| marker inside a fence not returned | `ignores a marker-shaped line inside a fenced block`, plus tilde and info-string variants |
| line with 2+ `[ORCH:*]` tokens rejected at both entry points | `findLastMarker rejects the wrapped nudge behind a prompt glyph`, `recoverLiteralMarkerFromTail rejects the same enumeration` |
| prose-prefixed marker not treated as a marker | `MARKER_LINE_RE` anchoring, pinned by the pre-existing `does not treat prose that mentions marker names as a marker` |
| protocol-explanation line rejected | `rejects a placeholder-and-alternatives tail behind a prompt glyph`, `rejects a tail instructing someone to emit a marker` |
| bridge-prompt examples still hidden | `tests/autopilot-attach-session.test.ts`, unmodified — zero-line diff against master |
| genuine markers still parse in all three forms | `keeps rejecting the pinned indented protocol example`, `leaves a single-token marker alone`, `now accepts the hyphenated progress tail the old heuristic suppressed`, and the 36 pre-existing tests |
| suppression keeps scanning, never strands | four tests under `findLastMarker keeps scanning past suppressed lines`, plus the end-to-end `force-settles on the marker the doer emitted` |
| `npx vitest run` on both protected files, assertions unmodified | 75/75; the only deleted line across the whole branch in `tests/autopilot-pty-watcher.test.ts` is an `import` statement |
| `npm test` green at every phase | 1081 → 1085 → 1090 → 1095 → 1097, green at each task boundary |
| both `tsc` projects | clean; `npm run build` also verified |

`tests/autopilot-pty-watcher.test.ts` went from 36 tests to 57. Diff is 224 additions,
1 deletion.

## Where the run departed from the plan

1. **Unbalanced fences do not suppress** (p1/t1). The plan said an unterminated fence
   should suppress to end of buffer. Only `emitSettle` clears the pty buffer, so an
   unclosed fence would have hidden the doer's own marker permanently — the marker never
   lands, the missing-marker path nudges twice, the run escalates. A stray ``` in prose
   would have been enough. Liveness beat strictness; pinned by a test named for the
   reason. Reported at the time and not overruled.
2. **`output-inspector.ts` was modified** (p3/t1). The task allowed this "only if its
   preview provably breaks". It did, and the proof came before the fix: the inspection
   reported the right marker with an empty structured block, having found the quoted copy
   by text search and read the closing fence as the block.

## What the tests caught that review did not

The documentation-tail clause took three cuts, and inspection caught none of them:

- matching bare `please` rejected `[ORCH:WAITING] review please` and broke four PRO
  state-machine tests;
- matching `emit the` then rejected `should I emit the commit now?`, caught by a
  regression test written in the same turn.

Both false positives are now pinned. The structural rules — fences, token counts,
placeholders, alternatives — landed correctly on the first attempt. **Recommendation for
whoever touches this next: extend structure, not vocabulary.**

## Known limits, stated rather than papered over

- **A user typing a bare marker cannot be detected in-band.** `'  [ORCH:GOAL_READY]'` from
  a person is byte-identical to the doer's, and two pinned tests require that form to
  parse. The `# ` answer-prefix convention in `attach-session.ts` remains the only
  defence, and it only covers text the bridge prompt itself renders.
- **`PtyWatcher.checkSettled` still locates the settle boundary by `lastIndexOf`.**
  Measured, not assumed: with a byte-identical quoted copy the boundary lands on the wrong
  line, but `findLastMarker` still supplies the marker and the before-text, so the cycle
  settles through the force-settle window instead of on idle. Latency, not correctness.
  Left alone on my recommendation; the same class of bug at the `output-inspector` site
  was fixed because there it lost data.
- **Multi-token suppression costs a genuine marker whose tail names another kind.** That
  text belongs on the `QUESTION:` line, which is where the orchestrator reads it from.
- **No phase reviews exist.** `.autopilot-pro/reviews/` is empty: each phase was advanced
  task-to-task, so Stage 3 never ran. This document carries the whole account instead.

## Scope discipline

Untouched, as the spec required: the file-based control channel and every
`control-channel.ts`, `schemaVersion` (still 1), `src/main/autopilot-council/`, the
renderer, and both `prompts.ts` doer contracts — no rule made an existing documented
example unparseable, so no contract needed rewording.

`CLAUDE.md` was updated because it documented the retired heuristic by name and pointed at
a "Known issue" that no longer exists.
