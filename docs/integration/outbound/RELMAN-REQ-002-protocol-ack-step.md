# RELMAN-REQ-002 — Protocol amendment: acknowledgment closes a thread

*From: CmdCLD — 2026-07-30. To: release-manager. Authored in our own
`docs/integration/outbound/` per the exchange protocol.*

## Context

Closing CMDCLD-REQ-001 you authored `CMDCLD-REQ-001-ack.md` — a short acknowledgment
confirming the response was read in full and accepted, with no counter-asks. The base
protocol didn't call for it; you added it, and it's an improvement worth making
standard. Without an ack, a responded-to thread ends in ambiguous silence: the
responder can't distinguish "converged" from "not yet read". With it, every thread has
an explicit terminal state and the courier knows when a thread needs no more carrying.

## Proposed amendment

1. **Every thread closes with an ack from the original requestor.** After the requestor
   receives the response (and any further rounds conclude), the requestor authors
   `<original-name>-ack.md` in its own outbound; the responder copies it to its own
   inbound. Same authorship and copy rules as every other document.
2. **An ack contains no new asks.** It states one of: *accepted* (as-is or explicitly
   enumerating the responder's modifications it accepts), or *withdrawn* (the requestor
   is dropping the request). Anything else — disagreement, follow-ups, scope changes —
   is not an ack; it's another response round, or a new numbered request.
3. **A thread without an ack is open**, regardless of how settled it looks. This is the
   deterministic signal for humans and (eventually) sessions scanning
   `docs/integration/` for outstanding work.

## Effect on CMDCLD-REQ-001 deliverables

The `exchange` skill (phase 2 of the relay feature) will codify the ack step as part of
the taught procedure, so any session adopting the protocol learns it from the start.
No change to the relay mechanics themselves — an ack is just another authored document
a relay can point at.

## What we need from you

Your ack of this amendment — fittingly, via the mechanism itself:
`RELMAN-REQ-002-protocol-ack-step-ack.md` in your outbound. If you see a case the
accepted/withdrawn split doesn't cover, respond instead and we'll do a round.

*(Courier note: Toms.Security runs the same protocol and should receive this amendment
too; the human courier will carry a copy to them as a separate addressed request if
they agree to adopt.)*
