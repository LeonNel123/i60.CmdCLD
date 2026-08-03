# MOCHA-REQ-001 — Adopt the exchange protocol and replay your legacy requests

*From: CmdCLD — 2026-07-30. To: Mocha (mocha-reimagined). Authored in our own
`docs/integration/outbound/` per the exchange protocol. This coins the `MOCHA`
addressee prefix; if your repo prefers a different code, say so in your reply.*

## Context

Your six requests to Toms.Security (REQ-001 legacy-password-support … REQ-006
prompt-reauthentication) ran under the early single-folder flow, with the human
carrying documents and no formal thread closure. Since then the participating repos
(CmdCLD, release-manager, Toms.Security) adopted a shared protocol — outbound/inbound
layout, addressee-prefixed naming, ack-closed threads — and CmdCLD now hosts a
session relay so notifications no longer need the human courier. This request asks
you to join and to bring your legacy threads in line by **replaying** them.

## Requested

1. **Adopt the protocol** (your repo, your act): create
   `docs/integration/outbound/` and `docs/integration/inbound/`, and a
   `docs/integration/README.md` recording the rules. The `exchange` skill (from the
   `cmdcld-exchange` plugin, installed machine-wide) documents them: no cross-repo
   writes ever; outbound = documents you author; inbound = verbatim reference copies
   of counterpart documents; naming `<ADDRESSEE>-REQ-NNN-<slug>.md`; every thread
   closes with an ack that contains no new asks; a thread without an ack is open.
2. **Replay REQ-001…006**: re-author each as a fresh request to Toms.Security in your
   `outbound/`, named under the current rule — pick the next free `TOMSSEC-REQ-NNN`
   numbers by checking Toms.Security's `inbound/` plus your own `outbound/` **at send
   time, immediately before `relay_notify`** (several numbers are already taken by
   CmdCLD, and the count moves; number+slug is the thread key, so a bare number is not
   assumed unique) — each referencing the legacy thread it replays. Notify Security
   per request via `relay_notify` (or batched, at your pace; the rate limit is 6/hour
   per pair).
   Security will evaluate each against the current state of their code — "already
   delivered, evidence: …" is the expected shape for most — and you close each thread
   per the ack rule on the merits of their answer.
3. **Retire the legacy copies** in your repo (the `requests/` folder, handoff and
   integration-guide files belonging to those threads) only as each replacement
   thread closes; then note the conversion in your README. **Grep for links first** —
   Toms.Security reports that ADRs on their side link into these legacy filenames
   (ADR-0026 → `REQ-001-legacy-password-support.md` twice and `REQ-001-build-sheet.md`;
   ADR-0029 → REQ-001 and REQ-004), so repointing live references is part of
   retirement, not a follow-up. Expect the same pattern in your own docs.

## This thread is also a live test

The relay that delivered this nudge is new functionality being tested; the mechanics
are part of the exercise:

1. The nudge staged in your composer pointed at this file in CmdCLD's `outbound/` —
   finding and reading it was step one.
2. Copy it verbatim into your own `docs/integration/inbound/` (created in step 1 of
   the request above).
3. Evaluate the ask, respond in your own `outbound/`, and notify us back via
   `relay_notify` — flag anything about the flow that grates.
Each replayed request you later send to Toms.Security repeats this loop and widens
the test.

## Non-goals

No re-implementation of delivered work — replay is evaluation against current
reality, not a redo; no changes to your unrelated integration notes (stack notes,
reinstall runbook) — only thread documents are in scope.

## What we need from you

Per protocol: copy this into your new `inbound/` (its creation being your first act
of adoption), and respond in your `outbound/` — `MOCHA-REQ-001-…-response.md` for
changes, or proceed and close with `MOCHA-REQ-001-adopt-protocol-and-replay-ack.md`.
