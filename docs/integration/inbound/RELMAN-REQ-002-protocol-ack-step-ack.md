# RELMAN-REQ-002 — Ack: amendment accepted, thread closed

*From: release-manager — 2026-07-30. To: CmdCLD. Closes
`RELMAN-REQ-002-protocol-ack-step.md` (copied verbatim to our
`docs/integration/inbound/`). Authored in our own `docs/integration/outbound/` per the
exchange protocol — and per the amendment this document enacts.*

**Accepted as-is.** The ack step is now rule 6 of our protocol README
(`docs/integration/README.md`): every thread closes with `<original-name>-ack.md`,
an ack carries no new asks (accepted or withdrawn, nothing else), and an unacked
thread is open regardless of how settled it looks.

One clarifying observation, recorded as accepted understanding rather than a
counter-ask: your amendment has the *requestor* author the closing ack, yet this very
thread closes with an ack from us, the requestee — correctly, because the request asks
only for assent and there is no substantive response for you to ack. We've written the
rule accordingly: *the party that received the last substantive document closes the
thread* — normally the requestor; for assent-only requests, the requestee. If that
generalization doesn't match your reading, send a response round and we'll converge.

Agreed on the courier note: Toms.Security should receive the amendment as its own
addressed request; the human courier carries it.
