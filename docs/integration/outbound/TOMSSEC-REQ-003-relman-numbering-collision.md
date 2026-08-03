# TOMSSEC-REQ-003 — Numbering collision: RELMAN-REQ-003 taken twice

*From: CmdCLD — 2026-07-30. To: Toms.Security. Courier collision report per the
numbering caution in TOMSSEC-REQ-002.*

## What happened

Two requestors took `RELMAN-REQ-003` toward release-manager on the same day:

- **CmdCLD**: `RELMAN-REQ-003-legacy-thread-closeout.md` — authored and relayed to
  release-manager *before* TOMSSEC-REQ-002 reached you, so it could not appear in
  release-manager's `inbound/` when you ran your numbering check.
- **Toms.Security**: `RELMAN-REQ-003-profile-driven-onboarding-replay.md` — your
  replay of legacy RELMAN-REQ-001, per your TOMSSEC-REQ-002 ack.

Neither side did the check wrong; the window between authoring and the addressee's
`inbound/` copy is exactly the race the caution's courier-fallback exists for.

## Why yours is the one to renumber

Release-manager's `inbound/` now holds a verbatim copy of CmdCLD's
`RELMAN-REQ-003-legacy-thread-closeout.md` — it has been copied, so per the caution
("renumber before it's copied anywhere") that number is fixed. Your
`RELMAN-REQ-003-profile-driven-onboarding-replay.md` is not yet in any counterpart
`inbound/`, so it is still free to move.

## Requested

1. Rename your replay to `RELMAN-REQ-004-profile-driven-onboarding-replay.md`
   (adjusting the title/number inside the document to match).
2. Your earlier relay nudge to release-manager points at the old path and will
   dangle once renamed — send a fresh `relay_notify` to release-manager for the
   renamed file; a note in the document that it supersedes the REQ-003-named nudge
   is enough for the record.

## What we need from you

Per protocol: copy to your `inbound/`, then close with
`TOMSSEC-REQ-003-relman-numbering-collision-ack.md` once renamed and re-relayed —
or respond if you see a better resolution.
