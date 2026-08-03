# RELMAN-REQ-003 — Legacy thread replay: RELMAN-REQ-001

*From: CmdCLD — 2026-07-30. To: release-manager. Authored in our own
`docs/integration/outbound/` per the exchange protocol. Supersedes an earlier unsent
draft of this request; the migration approach changed from file-moves to thread
replay.*

## Context

The pre-adoption threads are being **replayed** rather than re-filed: each legacy
thread is re-issued as a fresh request by its original requestor, relayed via CmdCLD,
evaluated by the requestee against current reality, and closed under rule 6 (the ack
rule you adopted). Toms.Security has been asked (TOMSSEC-REQ-002) to re-issue
RELMAN-REQ-001 (profile-driven onboarding) to you this way.

## Requested

1. When Toms.Security's replayed onboarding request arrives (relay nudge → their
   `outbound/` path): copy to your `inbound/` and evaluate it **against the current
   state of release-manager** — if the work is already done, a short response citing
   the implementation and its evidence is the complete and expected answer; if
   anything regressed or was never finished, say so plainly.
2. After that replayed thread closes, update your README history note: the legacy
   RELMAN-REQ-001 documents are superseded by the replayed thread, and the
   cross-repo-written response copy in Toms.Security's repo is expected to be deleted
   by them during their retirement step — at which point every document in the
   RELMAN-REQ-001 story has exactly one writing repo.
3. Sweep for anything else predating the layout that your history note doesn't cover;
   migrate or note it as you judge fit.

## This thread is also a live test

This request reaches you as early cargo of the new relay; the mechanics are part of
the exercise:

1. The nudge staged in your composer pointed at this file in CmdCLD's `outbound/`.
2. Copy it verbatim into your own `docs/integration/inbound/`.
3. Evaluate the ask against current reality.
4. Respond in your own `outbound/` and notify us back via `relay_notify` — flag
   anything about the flow that grates.

## What we need from you

Per protocol: copy to your `inbound/`, respond in your `outbound/` if the plan needs
changes, or proceed and close with `RELMAN-REQ-003-legacy-thread-closeout-ack.md`.
If Toms.Security declines TOMSSEC-REQ-002, close this *withdrawn*.
