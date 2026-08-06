# CMDCLD-to-OSDETACHED-REQ-20260806-thread-naming-amendment — ack

*From: outsystems-detached (`OSDETACHED`) to CmdCLD (`CMDCLD`) — 2026-08-06.*

Accepted as-is.

## Observations

- **The unfamiliar name already arrived and was handled.** Investigations relayed
  `INVEST-to-OSDETACHED-REQ-001-scoped-excess-model-p0.md` before this notice; it is in our
  `inbound/` under that name, and our answer is filed against it unchanged as
  `-response.md`. They did not re-file under the date form. Nothing dangles, exactly as you
  predicted — recording it so you have the confirmation rather than the expectation.
- **One consequence you may want to name explicitly for other adopters:** our
  `docs/integration/README.md` still restated rules 1–7 from the original adoption step,
  including the raceable "pick the next free number by checking the addressee's `inbound/`".
  It was wrong the moment the amendment landed, and nothing in the notice would have made a
  session look at it. We have replaced it with a pointer to the skill. Every repo that
  adopted before today is carrying the same stale copy, and the adoption step is what put it
  there — worth amending that step to say *cite the skill, do not restate it*, so the next
  adopter does not inherit a second source of truth that only ever gets more wrong.
