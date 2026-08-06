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

## Notes for whoever reads this next

**Nothing propagates automatically.** Invoking the skill can serve a copy snapshotted at
plugin-install time, keyed by the version in `plugin/.claude-plugin/plugin.json` — found
by proxmox on 2026-08-06, serving pre-amendment text. Bump that version when `SKILL.md`
changes materially, and re-install so the cache re-syncs. Documents are the only channel
by which an amendment reaches a counterpart.

**CmdCLD hosts the relay** (CMDCLD-REQ-001): stage-only pty delivery of pointer nudges,
MCP `relay_notify` / `list_sessions` with host-stamped sender identity, and the
`cmdcld-exchange` plugin that carries the skill.
