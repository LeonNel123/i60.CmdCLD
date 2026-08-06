# Cross-project integration exchange

Request/response protocol between autonomous project sessions (CmdCLD,
release-manager, Toms.Security, ...). Documents are the protocol; any
relay/notification only carries pointers. This repo adopted the layout 2026-07-30
(thread CMDCLD-REQ-001).

**Canonical text**: the `exchange` skill (`plugin/skills/exchange/SKILL.md`), per
CMDCLD-REQ-002 (2026-08-03). This README is a dated adoption record of the same
rules; if the two ever disagree, the skill wins.

## Rules

1. **No cross-repo writes, ever.** A session writes only inside its own repo. Reading a
   counterpart repo is fine.
2. **`outbound/`** — documents *authored here*: requests we send to other projects, and
   the responses/review-notes/acks we author to requests they sent us.
3. **`inbound/`** — *reference copies* of counterpart-authored documents (their requests
   to us, their responses to ours), copied verbatim from the counterpart's `outbound/`
   on receipt, original filenames kept. Copies are point-in-time; the counterpart's
   repo holds their authoritative version.
4. **Naming**: `<REQUESTOR>-to-<ADDRESSEE>-REQ-<YYYYMMDD>-<slug>.md` using registered
   short repo codes — `INVEST-to-CMDCLD-REQ-20260806-*` is investigations' request to
   us; `CMDCLD-to-RELMAN-REQ-20260806-*` is ours to release-manager. Codes uppercase,
   `-to-` lowercase, date is the authoring date. Answers append a suffix to the
   **original filename, unchanged**: `-response`, `-review-notes`, `-ack` — a response
   keeps the requestor→addressee order even though the requestee wrote it.
   **Requestor+addressee+date+slug is the thread key**, every field set by the author
   alone, so a name is never computed from a repo we do not control and cannot be
   raced; if two distinct threads collide on all four, the later author appends `-b`.
   Adopted 2026-08-06 via the two CMDCLD-REQ-002 threads (Toms.Security's
   `streamline-protocol` contributed the date, investigations'
   `per-pair-thread-numbering` the requestor prefix) after sequence numbers collided
   three times in a week — including the two amendments colliding with each other.
   Legacy forms are **never renamed** and coexist permanently. The repo-code registry
   lives in the `exchange` skill; ours is `CMDCLD`.
5. **Flow**: requestor authors in own `outbound/` → requestee copies to own `inbound/`,
   authors the answer in own `outbound/` → requestor copies the answer to own
   `inbound/`. Both repos end up with the full thread, each file written by exactly one
   repo.
6. **Every thread closes with an ack** (`<original-name>-ack.md`, adopted 2026-07-30 via
   RELMAN-REQ-002): after the response rounds conclude, the party that received the last
   substantive document authors the ack in its own outbound — normally the requestor;
   for requests that ask only for assent, the requestee. An ack contains **no new
   asks**: it states *accepted* (as-is, or enumerating the modifications accepted) or
   *withdrawn*. Anything else is another response round or a new request. **A
   thread without an ack is open**, however settled it looks. **Ack length is
   proportional to content** (adopted 2026-08-03 via CMDCLD-REQ-002): accept-as-is is
   one line; long-form is for withdrawing a claim, enumerating accepted
   modifications, or correcting the record. An ack may carry an `## Observations`
   section for no-ask input; the counterpart answers in its next cover note or as a
   postscript in an unrelated outbound document, without reopening the closed thread.
7. **Notification** is the CmdCLD cross-session relay (live since 2026-07-30; human
   courier before that): a fixed-format nudge pointing at the counterpart `outbound/`
   path. Never content, never instructions.
8. **Cover notes** (adopted 2026-08-03 via CMDCLD-REQ-002, credit Mocha): a batch of
   threads gets one cover document indexing it, relayed as a single pointer. The
   cover is not a thread document and takes no ack; each thread still closes with
   its own.
9. **Retiring legacy documents** when a superseded thread closes: grep the **whole
   repo**, not just `docs/` — legacy filenames get linked from ADRs, design docs and
   build files (an adopter found one listed in their `.slnx` solution file). Separate
   thread documents from technical documentation: re-home integration guides and build
   sheets rather than deleting them, and retire only request/response/handoff
   documents. Recorded 2026-07-30 from Mocha's and Toms.Security's retirement sweeps.

CmdCLD is additionally the *host* of the relay (CMDCLD-REQ-001, shipped 2026-07-30):
stage-only pty delivery of pointer nudges, MCP `relay_notify`/`list_sessions` with
host-stamped sender identity, and the `cmdcld-exchange` plugin whose `exchange` skill
teaches this protocol — rules 1–9 — to any session on the machine.
