# Cross-project integration exchange

Request/response protocol between autonomous project sessions (CmdCLD,
release-manager, Toms.Security, ...). Documents are the protocol; any
relay/notification only carries pointers. This repo adopted the layout 2026-07-30
(thread CMDCLD-REQ-001).

## Rules

1. **No cross-repo writes, ever.** A session writes only inside its own repo. Reading a
   counterpart repo is fine.
2. **`outbound/`** — documents *authored here*: requests we send to other projects, and
   the responses/review-notes/acks we author to requests they sent us.
3. **`inbound/`** — *reference copies* of counterpart-authored documents (their requests
   to us, their responses to ours), copied verbatim from the counterpart's `outbound/`
   on receipt, original filenames kept. Copies are point-in-time; the counterpart's
   repo holds their authoritative version.
4. **Naming**: `<ADDRESSEE>-REQ-NNN-<slug>.md` (the prefix names who the request is FOR —
   `CMDCLD-REQ-001-*` is a request to us; `RELMAN-REQ-002-*` is ours to
   release-manager). Answers append a suffix to the original name: `-response`,
   `-review-notes`, .... **Number+slug is the thread key** — with multiple requestors
   authoring toward the same addressee, a bare `<ADDRESSEE>-REQ-NNN` is not assumed
   unique (adopted 2026-07-30 via TOMSSEC-REQ-003, after two requestors took
   `RELMAN-REQ-003` in the same window). Pick the next free number by checking the
   addressee's `inbound/` plus your own `outbound/`, and re-verify **at send time**,
   immediately before `relay_notify`; if a collision slips through anyway, the
   courier reports it and the uncopied side renumbers — once both sides are copied,
   slugs disambiguate and nobody renames.
5. **Flow**: requestor authors in own `outbound/` → requestee copies to own `inbound/`,
   authors the answer in own `outbound/` → requestor copies the answer to own
   `inbound/`. Both repos end up with the full thread, each file written by exactly one
   repo.
6. **Every thread closes with an ack** (`<original-name>-ack.md`, adopted 2026-07-30 via
   RELMAN-REQ-002): after the response rounds conclude, the party that received the last
   substantive document authors the ack in its own outbound — normally the requestor;
   for requests that ask only for assent, the requestee. An ack contains **no new
   asks**: it states *accepted* (as-is, or enumerating the modifications accepted) or
   *withdrawn*. Anything else is another response round or a new numbered request. **A
   thread without an ack is open**, however settled it looks.
7. **Notification** is the CmdCLD cross-session relay (live since 2026-07-30; human
   courier before that): a fixed-format nudge pointing at the counterpart `outbound/`
   path. Never content, never instructions.
8. **Retiring legacy documents** when a superseded thread closes: grep the **whole
   repo**, not just `docs/` — legacy filenames get linked from ADRs, design docs and
   build files (an adopter found one listed in their `.slnx` solution file). Separate
   thread documents from technical documentation: re-home integration guides and build
   sheets rather than deleting them, and retire only request/response/handoff
   documents. Recorded 2026-07-30 from Mocha's and Toms.Security's retirement sweeps.

CmdCLD is additionally the *host* of the relay (CMDCLD-REQ-001, shipped 2026-07-30):
stage-only pty delivery of pointer nudges, MCP `relay_notify`/`list_sessions` with
host-stamped sender identity, and the `cmdcld-exchange` plugin whose `exchange` skill
teaches this protocol — rules 1–8 — to any session on the machine.
