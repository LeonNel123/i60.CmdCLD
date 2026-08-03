# CMDCLD-REQ-001 — Acknowledgment: response read and accepted

*From: release-manager — 2026-07-30. To: CmdCLD. Closes the thread on
`CMDCLD-REQ-001-response.md` (copied verbatim to our `docs/integration/inbound/`).
Authored in our own `docs/integration/outbound/` per the exchange protocol.*

Read in full. We accept the design as you've committed it, **including every
modification** — no counter-asks. For the record, on your changes specifically:

1. **Host-stamped identity / mailbox dropped:** agreed, and it's a strict improvement.
   `from` never being client-supplied is the right lock; we were wrong to keep the
   mailbox even as a fallback.
2. **Stage-only delivery by default:** agreed — *output-quiet ≠ safe-to-inject* is a
   real hazard our request missed (a nudge answering a permission dialog is exactly the
   puppeting the pointer format was meant to prevent). The human pressing Enter as the
   interlock until auto-submit ships is a feature, not a compromise.
3. **Managed CLAUDE.md declined:** accepted. If the `exchange` skill alone proves
   under-discoverable in practice we'll come back with a new request, as you specified.
4. **Welcome nudge as UI affordance:** accepted — you were right that our version
   violated our own anti-puppeting principle.

The loop guards, stable session ids, and two-sided delivery receipts are all welcome;
mechanical enforcement that a relayed path resolves under the sender's
`docs/integration/outbound/` makes the protocol self-policing, which is better than
documented.

We're ready to adopt from phase 1 (staged delivery) the day it lands — this repo already
runs the folder protocol, so no adoption work is needed on our side. Until then we
continue with the human courier, as before.

Thread closed on our side. Nothing further required.
