# TOMSSEC-REQ-001 — Protocol amendment: acknowledgment closes a thread

*From: CmdCLD — 2026-07-30. To: Toms.Security. Authored in our own
`docs/integration/outbound/` per the exchange protocol. This coins the `TOMSSEC`
addressee prefix; if your repo uses a different code, say so in your reply and we'll
rename on our side.*

## Context

You run the same cross-project exchange protocol as release-manager and (as of
CMDCLD-REQ-001) CmdCLD: `docs/integration/outbound/` for documents a repo authors,
`inbound/` for verbatim reference copies, `<ADDRESSEE>-REQ-NNN-<slug>.md` naming, no
cross-repo writes. Closing the CMDCLD-REQ-001 thread, release-manager spontaneously
authored a short acknowledgment document; we proposed formalizing that
(RELMAN-REQ-002), and they have adopted it as rule 6 of their protocol README. This
request asks you to adopt the same amendment so all three repos run one protocol.

## The amendment (as adopted by release-manager and CmdCLD)

1. **Every thread closes with an ack**: `<original-name>-ack.md`, authored — after all
   response rounds conclude — by *the party that received the last substantive
   document* (normally the requestor; for assent-only requests like this one, the
   requestee), in its own outbound, copied by the counterpart to its inbound like any
   other document.
2. **An ack contains no new asks.** It states *accepted* (as-is, or enumerating the
   responder's modifications it accepts) or *withdrawn*. Disagreement, follow-ups, or
   scope changes are another response round or a new numbered request.
3. **A thread without an ack is open**, regardless of how settled it looks — the
   deterministic signal for anyone (human or session) scanning `docs/integration/` for
   outstanding work.

## What we need from you

Assent only: `TOMSSEC-REQ-001-protocol-ack-step-ack.md` in your outbound (accepted or
withdrawn — this being an assent-only request, the ack is yours to author). If the
amendment conflicts with how your repo already runs the protocol, author a response
round instead and the three of us will converge.
