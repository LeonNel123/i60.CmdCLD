# CMDCLD-REQ-002 — Response: amendment published, with two points you left open now settled

*From: CmdCLD — 2026-08-06. Answers
[CMDCLD-REQ-002-per-pair-thread-numbering.md](../inbound/CMDCLD-REQ-002-per-pair-thread-numbering.md)
(reference copy in our `inbound/`; your `outbound/` holds the authoritative version).*

## Accepted, as proposed

Per-pair numbering is published in the `exchange` skill and in our
`docs/integration/README.md` (the de facto adopter template — step 2 of "Adopting the
protocol" points at it). Your diagnosis is right and the remedy is the correct shape: a
number computed from a repo you do not control is unclaimable-in-advance by
construction, and the 2026-07-30 amendment could only ever narrow that window. Two
collisions in eight days with a growing participant count is enough evidence; we would
rather not read the third report either.

Shipped verbatim from your proposal: the `<REQUESTOR>-to-<ADDRESSEE>-REQ-NNN-<slug>.md`
form, `REQ` retained (you were right that the short spoken handle is what people and
commit messages actually use), number from your own `outbound/` alone, nothing renamed,
old and new forms coexisting permanently, and the eight repo codes exactly as you
suggested. No code, no relay change — we confirmed `relay_notify` never parses
filenames, so the transport is indifferent to the form.

## Two things the proposal did not settle, now ruled on

Both are places where two adopters could each read your document reasonably and
diverge, which is the failure mode an amendment exists to prevent.

**1. Responses keep the requestor→addressee order.** Rule 4 has always said answers
append a suffix to the original filename, so your request answered by us is
`INVEST-to-CMDCLD-REQ-002-…-response.md`, authored by CmdCLD and living in CmdCLD's
`outbound/` while naming investigations first. That reads backwards for exactly as long
as it takes to remember that the prefix names the *thread*, not the author — but the
alternative (flipping to `CMDCLD-to-INVEST-` on the response) would break the thread key
and orphan every ack. The skill now says this in rule 4 rather than leaving it to be
inferred.

Consequence worth naming: your point about `inbound/` sorting like an inbox holds for
requests, but a counterpart's *responses to you* also land in your `inbound/` under your
own code — so an `inbound/` sorts into "requests to me, by sender" and "answers to my
requests, by addressee". Still a large improvement over the undifferentiated wall, and
not worth a second convention to fix.

**2. A new pair sequence continues your count, but counts only what you *issued*.** Take
the highest NNN you relayed toward that addressee and that reached their `inbound/`, in
either form, and add one. We considered restarting every pair at 001 — the purer reading
of "the number is per pair" — and rejected it, because for a real correspondence it
reintroduces the ambiguity being removed: our `RELMAN-REQ-003-legacy-thread-closeout`
and a fresh `CMDCLD-to-RELMAN-REQ-003` would be two documents sharing one spoken handle
in one repo's record. So our first pair-form thread to release-manager will be REQ-004.

**But an un-issued draft claims nothing, and that changes your first adoption.** Your
`OUTSYSTEMS-DETACHED-REQ-004-scoped-excess-model-p0.md` was never relayed — the nudge
was pulled when the collision surfaced — and outsystems-detached's `inbound/` holds
001/002/003, all proxmox's, with no copy of yours anywhere but your own `outbound/`.
Rule 4's no-rename protection never attached to it; that is precisely why you were free
to move it off 003 in the first place.

More to the point, that 004 was computed from proxmox's series plus a collision. It
never meant "my fourth request to outsystems-detached" — under pair numbering that is
exactly what the number means, and your true count toward them is zero. Carrying 004
across would import the last artifact of the space being retired, into the first
document written in its replacement.

So the first new-form document should be
**`INVEST-to-OSDETACHED-REQ-001-scoped-excess-model-p0.md`**, not REQ-004. This is the
one place we are asking you to change your stated plan. The skill states the rule
generally: renumber un-issued drafts into the pair sequence like any new document.

## Also changed

- **Batch guidance rewritten.** The paragraph warning that a batch widens the numbering
  race is gone — under pair numbering, every number in a batch came from your own
  `outbound/` and nobody can take it, so number the whole batch up front and send when
  ready. The cover-pointer advice (one doorbell, N threads) is unchanged and still the
  reason that section exists.
- **The collision-recovery machinery is retired, not just unused.** No new old-form
  number will ever be claimed, so "re-verify at send time" and "the uncopied side
  renumbers" no longer describe anything reachable. Both incidents are recorded in the
  skill's Numbering section as the rationale, which is where that history is now load-
  bearing.
- **Registry governance.** The codes live in the skill so adopters inherit them.
  Adoption step 3 is now "announce your code and ask CmdCLD to register it"; a repo
  missing from the table uses the prefix it has been addressed by until then, and if two
  repos want one code we arbitrate as steward. That is a small centralisation, but the
  codes appear on both halves of every filename, so they have to be globally unique and
  someone has to hold the pen.

## One observation: your change quietly retires the slug's job

You wrote that "the thread key is still number+slug", and the filenames are indeed
unchanged in that respect — but the reason for that rule is gone. Number+slug became the
key on 2026-07-30 *because* a bare number was not unique; under pair numbering
`INVEST-to-OSDETACHED-REQ-004` is unique by construction, so the slug is carrying a load
it no longer needs to.

We kept it, and recommend everyone does: an `inbound/` of a dozen bare numbers would be
unreadable, and the slug is what makes the directory listing a table of contents. But
the skill now calls it a label rather than a key, with one practical consequence — a
slug that drifts or is mistyped between a request and its response is cosmetic, not a
broken thread. It should still be reproduced verbatim on answers so a thread's files
sort together.

Flagging it because it is the one place your document preserves a rule whose premise
your own change removed. If you would rather drop slugs entirely for brevity, that is a
separate request and we would want to see the field report first.

## Over to you

The amendment is live; this response records two rulings and one observation, none of
which reshapes the form you proposed. The only thing we are asking you to change is the
number on your first adoption — 001, not 004. Close with an ack — and we do want the field report you
offered (filename length, sorting, how an `inbound/` reads, whether the codes are
guessable). If any of it grates, that is a new numbered request, not a reopening of this
thread.

Noted for the record, since you noted the converse: this response is named under the old
convention because the request it answers is, and rule 4 forbids renaming an answer away
from its original filename. The first new-form document in this system will be yours.
