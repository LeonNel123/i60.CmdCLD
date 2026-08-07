# Cross-project integration exchange

Request/response protocol between autonomous project sessions. Documents are the
protocol; any relay/notification only carries pointers.

**The rules live in the `exchange` skill — `plugin/skills/exchange/SKILL.md` — and are
deliberately not restated here.** This file is a dated adoption record: what this repo
adopted and when. A README that restates the rules becomes a second source of truth
that only ever gets more wrong, which outsystems-detached found on 2026-08-06 while
still carrying the original raceable numbering step.

Our repo code is `CMDCLD`. `outbound/` holds documents we author; `inbound/` holds
verbatim copies of counterpart-authored ones.

## Adoption record

| Date | Thread | What we adopted |
| --- | --- | --- |
| 2026-07-30 | CMDCLD-REQ-001 | The `docs/integration/` layout, and shipped the relay that carries the nudges |
| 2026-07-30 | RELMAN-REQ-002 | Every thread closes with an ack |
| 2026-07-30 | TOMSSEC-REQ-003 | Number+slug as thread key, after two requestors took `RELMAN-REQ-003` *(superseded 2026-08-06)* |
| 2026-07-30 | TOMSSEC-REQ-002, MOCHA-REQ-001 | Retirement sweeps grep the whole repo, not just `docs/` |
| 2026-08-03 | CMDCLD-REQ-002-streamline-protocol | Proportional ack length, `## Observations` on acks, cover notes as rule 8 (credit Mocha), and **the skill as canonical text** |
| 2026-08-06 | CMDCLD-REQ-002-per-pair-thread-numbering | Per-pair numbering *(superseded the same day)* |
| 2026-08-06 | Both REQ-002 threads reconciled | `<REQUESTOR>-to-<ADDRESSEE>-REQ-<YYYYMMDD>-<slug>` — the date from one thread, the requestor prefix from the other, after the two amendments collided with each other |
| 2026-08-07 | CMDCLD-to-\*-REQ-20260807-install-source-moves-to-github | The skill is hosted from the GitHub fork rather than this checkout, `SKILL.md` stamps its own protocol version, and adoption step 3 keeps the install pair — and only that pair — literal in a README |

## Notes for whoever reads this next

**Nothing propagates automatically.** Invoking the skill can serve a copy snapshotted at
plugin-install time, keyed by the version in `plugin/.claude-plugin/plugin.json` — found
by proxmox on 2026-08-06, serving pre-amendment text. Bump that version when `SKILL.md`
changes materially, bump the matching `Protocol version` stamp inside `SKILL.md`, and
push — the marketplace refreshes from the remote. Auto-update, once toggled on for the
marketplace (it is off by default for everything but Anthropic's own), makes the
refresh automatic — but it compares versions, so an unbumped edit stays invisible, and
it moves text, not agreement. Documents remain the only channel by which an amendment
reaches a counterpart.

**The skill installs from GitHub, not from this checkout** (since plugin 1.2.0):
`claude plugin marketplace add https://github.com/dewald-behm/i60.CmdCLD.git#wip-dewald`.
The `#wip-dewald` pin exists only because `plugin/` is not on `master` yet; it drops
when that PR lands. Before 1.2.0 the marketplace was this directory and the skill named
a working-copy path as canonical, so counterparts on other machines had no way to read
the text they were told was authoritative.

**CmdCLD hosts the relay** (CMDCLD-REQ-001): stage-only pty delivery of pointer nudges,
MCP `relay_notify` / `list_sessions` with host-stamped sender identity, and the
`cmdcld-exchange` plugin that carries the skill.
