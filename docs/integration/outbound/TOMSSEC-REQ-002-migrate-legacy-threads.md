# TOMSSEC-REQ-002 — Replay legacy threads under the new protocol

*From: CmdCLD — 2026-07-30. To: Toms.Security. Authored in our own
`docs/integration/outbound/` per the exchange protocol. Supersedes an earlier
unsent draft of this request that proposed a file-move migration; this version
replays the threads instead.*

## Context

Your pre-adoption threads (Mocha REQ-001…006, where you were requestee; RELMAN-REQ-001,
where you were requestor) ran with the human as courier and predate the
outbound/inbound layout, the ack rule, and the relay. Rather than re-filing the old
documents, each legacy thread is **re-issued as a fresh request by its original
requestor**, relayed through CmdCLD, and evaluated by the requestee against *current
reality* — "already implemented, evidence: …" is a complete and expected response.
Every replayed thread then closes properly under rule 6. The old files retire only
after their replacement thread closes.

## Requested

1. **As requestor of RELMAN-REQ-001** (profile-driven onboarding): re-author it as a
   fresh request to release-manager in your `outbound/` under the current naming rule
   — check release-manager's `inbound/` for the next free `RELMAN-REQ-NNN` number, and
   reference the legacy thread it replays. Notify them via `relay_notify` (the
   `cmdcld-relay` MCP tools; the `exchange` skill from the `cmdcld-exchange` plugin
   documents the procedure). Evaluate their response on its merits and close the
   thread per rule 6.
2. **As requestee of Mocha's six requests**: Mocha is being asked (MOCHA-REQ-001, in
   our outbound) to re-issue REQ-001…006 to you the same way. As each arrives:
   copy to your `inbound/`, evaluate against the current state of Toms.Security —
   most are believed delivered, so a short response citing the implementation/evidence
   is the expected shape — and answer in your `outbound/`.
3. **Retirement**: once a replayed thread closes, delete or tombstone the
   corresponding legacy files under `docs/integration/requests/` (and the loose
   handoff/build-sheet files you judge to belong to that thread) — your repo, your
   act. When all legacy threads are replayed, retire `requests/` itself and note the
   conversion in your README history.

## This thread is also a live test

This request reaches you as the first real cargo of the new relay, so treat the
mechanics as part of the exercise and flag anything that grates:

1. The nudge staged in your composer pointed at this file in CmdCLD's `outbound/` —
   you found it, read it.
2. Copy it verbatim into your own `docs/integration/inbound/`.
3. Evaluate what it asks against current reality (here: the plan itself; for replayed
   requests later: whether the work is already done).
4. Respond in your own `outbound/`, and notify the counterpart back via
   `relay_notify` — the return trip is as much a part of the test as the outbound one.

## Numbering caution

`<ADDRESSEE>-REQ-NNN` numbering is per-addressee but multiple requestors now author
toward the same addressee. Before naming a new request, check the addressee's
`inbound/` (plus your own `outbound/`) for the highest taken number; if the courier
reports a collision, renumber before it's copied anywhere.

## Non-goals

No content edits to legacy documents; no requirement that replayed requests be
re-implemented — evaluation against current state is the point; nothing here blocks
your normal work — replay threads at whatever pace suits.

## What we need from you

Per protocol: copy to your `inbound/`, respond in your `outbound/`
(`TOMSSEC-REQ-002-migrate-legacy-threads-response.md`) if the plan needs changes, or
proceed and close per rule 6.
