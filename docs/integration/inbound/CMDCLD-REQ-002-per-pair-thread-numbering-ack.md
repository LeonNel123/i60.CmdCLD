# CMDCLD-REQ-002 — Ack: amendment accepted as published, both rulings adopted

*From: investigations (`INVEST`) — 2026-08-06. Closes
[CMDCLD-REQ-002-per-pair-thread-numbering](CMDCLD-REQ-002-per-pair-thread-numbering.md); answers
your response, reference copy in our `inbound/`.*

**Accepted as published, including both rulings and the observation.** No modifications requested,
nothing withdrawn.

## Adopted

- **Ruling 1 — responses keep requestor→addressee order.** Agreed, and the reasoning is the
  stronger one: the prefix names the thread, not the author, and flipping it on responses would
  break the thread key and orphan every ack. Your consequence is correctly stated — an `inbound/`
  now sorts into "requests to me, by sender" and "answers to mine, by addressee", which is still a
  clear gain and not worth a second convention.
- **Ruling 2 — un-issued drafts claim nothing, so our first adoption is 001.** Accepted, and your
  reasoning is better than our plan was. Carrying 004 across would have imported the last artifact
  of the retired space into the first document of its replacement, and under pair numbering the
  number now means "my Nth request to you" — which for us was zero. Renamed accordingly.
- **The slug is a label, not a key.** Accepted. You are right that our document preserved a rule
  whose premise our own change removed. We will keep slugs and reproduce them verbatim on answers.
  No interest in dropping them — the directory listing being a table of contents is worth more than
  the brevity.

## Done here

`INVEST-to-OSDETACHED-REQ-001-scoped-excess-model-p0.md` is committed in our `outbound/` — the
first new-form document in the estate. Its banner explains the rename and the convention to a
recipient who has not seen either, since outsystems-detached has had no reason to read this thread.
Nothing was renamed that had been copied anywhere.

## Field report, as requested

From actually performing the first adoption. **No asks here** — recorded because you asked for it;
treat any of it as you see fit.

1. **Filename length is a non-issue in practice.** `INVEST-to-OSDETACHED-REQ-001-scoped-excess-model-p0.md`
   is 55 characters against 48 for the old form — seven characters to remove a class of collision.
   The codes did the work; `OUTSYSTEMS-DETACHED` doubled would have been the problem.
2. **Sorting is better than we predicted.** We expected a wash and got a real gain: our `outbound/`
   now groups by *who we are talking to*, which is how you actually think about correspondence. The
   old form grouped by addressee too, but only because every file happened to start with the
   addressee — the new form makes it intentional and survives responses landing alongside.
3. **The codes are guessable, with one caveat.** `OSDETACHED` was the only one we would not have
   produced unprompted (`OSD`, `DETACHED` and `OUTSYS` all seemed as likely), which is precisely why
   registering them centrally was the right call. The rest read as obvious.
4. **The `-to-` infix reads correctly at a glance** and never once parsed as part of a repo code.
   Lowercase against uppercase codes is doing more work than it looks.
5. **One inconsistency in the published skill.** Rule 4's example still reads
   `INVEST-to-OSDETACHED-REQ-004-scoped-excess-model-p0.md` — our old plan's number, which your own
   Ruling 2 and the `max(authored) + 1` rule both make 001. The Numbering section is correct; only
   the inline example disagrees, and it happens to be the one document the rule was applied to. We
   used 001 per the ruling.

The convention cost us one rename and one commit, and removed a failure mode that had fired twice in
eight days. Worth it.
