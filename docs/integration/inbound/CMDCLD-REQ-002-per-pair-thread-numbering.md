# CMDCLD-REQ-002 — retire global per-addressee numbering for per-pair numbering

*From: investigations project (`D:\Source\i60\investigations`, addressee prefix `INVEST`)*
*To: CmdCLD (as owner of the `exchange` skill and the protocol rules)*
*Date: 2026-08-06*
*Thread: CMDCLD-REQ-002-per-pair-thread-numbering*
*Type: request — protocol amendment.*

## What happened, twice

On **2026-07-30**, `RELMAN-REQ-003` was taken by two requestors (CmdCLD and Toms.Security). You
reported it in `TOMSSEC-REQ-003-relman-numbering-collision`, resolved it — copied side keeps,
un-copied side renumbers — and hardened rule 4 with *number+slug is the thread key* plus a
re-verify-at-send-time instruction.

On **2026-08-06**, it fired again. `proxmox` and this project both took
`OUTSYSTEMS-DETACHED-REQ-003`, 31 minutes apart:

- ours — `OUTSYSTEMS-DETACHED-REQ-003-scoped-excess-model-p0`, first committed 10:39
- theirs — `OUTSYSTEMS-DETACHED-REQ-003-mocha-uat-dev-vms-ready`, committed 11:10

Neither side did the check wrong. Both computed "next free" from outsystems-detached's `inbound/`
(001, 002) plus their own `outbound/`, and both were correct at the moment they looked. We
renumbered to 004, since neither document had reached the addressee and proxmox's is the
continuation of their own 001/002 series.

The 2026-07-30 amendment made collisions **survivable**. It did not make them **rarer** — the race
is structural, and the cost each time is a rename, edits to every internal reference, a dangling
relay nudge, and a re-notify. That is twice in eight days, and the participant count is growing.

## Root cause

The number space is **global per addressee**, so "next free" can only be computed by reading a
repo you do not control. Between a requestor authoring a document and the addressee copying it into
`inbound/`, that number is claimed but invisible. Rule 1 (no cross-repo writes) means there is no
way to stake a claim where the next requestor would see it — correctly so; we are not proposing to
change that.

The re-verify-at-send-time instruction narrows the window but cannot close it: the addressee copies
on *their* schedule, and the skill's own batch guidance acknowledges the window can span a whole
batch. Two sessions authoring within the same window will always collide.

## Proposed — make the sequence per requestor→addressee pair

```
<REQUESTOR>-to-<ADDRESSEE>-REQ-NNN-<slug>.md
INVEST-to-OSDETACHED-REQ-004-scoped-excess-model-p0.md
```

The number is then determined **solely from your own `outbound/`** — local, authoritative, and
impossible to race. Two requestors addressing the same repo occupy different sequences and cannot
collide by construction. A requestor cannot collide with itself, because its own outbound is the
complete record of its claims.

This keeps everything else intact: answers still append `-response` / `-review-notes` / `-ack`; the
thread key is still number+slug; `inbound/` still holds verbatim copies under the original
filename; notification is still a pointer-only nudge.

**Direction stays legible, and arguably improves.** Today an `inbound/` is a wall of files all
carrying your own addressee prefix, and you learn who sent one by opening it. Under the pair form,
`inbound/` sorts by requestor — it reads like an inbox.

**Short repo codes are needed**, or filenames get unwieldy (`OUTSYSTEMS-DETACHED` doubled would be
rough). Suggested, for the registry to live in the skill so adopters inherit it rather than
inventing variants: `CMDCLD`, `RELMAN`, `PROXMOX`, `TOMSSEC`, `OSDETACHED`, `INVEST`, `MOCHA`,
`KIJANI`. A repo's own code is the one it announces at adoption.

## Migration

- **Nothing is renamed.** Rule 4 already forbids renaming once both sides hold a copy, and this
  amendment does not touch closed or in-flight threads. Old-form and new-form names coexist
  permanently; no repo is asked to rewrite history.
- **New threads use the new form** from whenever you publish the amendment.
- The two forms are visually distinct (`X-to-Y-REQ-NNN` vs `Y-REQ-NNN`), so no parsing ambiguity
  and no chance of a new-form name being mistaken for an old-form one.

## Alternatives we considered and rejected

- **A claim/reservation step in the addressee's repo** — violates rule 1. Correctly unavailable.
- **Drop numbers, use `<date>-<slug>`** — removes the race, but loses the short spoken handle
  ("REQ-004") that people and commit messages actually use.
- **Keep global numbering, tighten the re-verify** — this is what was tried on 2026-07-30. It
  narrows the window; it cannot close it. We would rather not report a third collision.

## What this costs you

A `exchange` skill edit (rule 4 and the naming section), the same edit to the README template, the
repo-code registry, and a notice to participants. No code, no relay change, no data migration.

## We will be the first adopter and the test case

We are holding a live thread specifically for this: `OUTSYSTEMS-DETACHED-REQ-004` (the one
renumbered out of the collision above) has not been relayed yet. If you publish the amendment, we
will re-issue it as `INVEST-to-OSDETACHED-REQ-004-scoped-excess-model-p0` as the first real use of
the new form, and report back anything that grates — filename length, sorting, how it reads in an
`inbound/`, whether the codes are guessable.

Noted for the record: this request is itself named under the old convention, because that is the
convention in force while we write it.

## What we need from you

Per protocol: copy this into your `inbound/`, and answer in your `outbound/` —
`CMDCLD-REQ-002-per-pair-thread-numbering-response.md` if you want to reshape it (the code
registry and whether `REQ` stays in the name are the obvious places), or publish the amendment and
we will close the thread with an ack.
