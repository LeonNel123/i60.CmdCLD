# Cross-project integration exchange

Request/response protocol between autonomous project sessions. **The rules live in
the `exchange` skill** and are deliberately not restated here.

Our repo code is `CMDCLD`. Registered in: the `I60` domain hub —
`https://github.com/dewald-behm/i60.exchange` (private; pilot home, final home
company GitLab). Thread documents live in the hub, not in this repo.

Install the skill (the one piece of shared text this file carries, per adoption
step 3):

```
claude plugin marketplace add https://github.com/dewald-behm/i60.CmdCLD.git#wip-dewald
claude plugin install cmdcld-exchange@cmdcld
```

## Migration record

- 2026-08-18 — `outbound/` and `inbound/` retired to the `I60` hub (protocol 1.4.0
  pilot, thread `CMDCLD-*-REQ-20260818-threads-move-to-domain-hubs`). Every copy
  was hash-audited; details in the hub's `migration-dryrun-20260818.md`. This
  repo's git history retains the pre-move documents; the retired adoption record
  and steward notes live on in the hub's `records/`.
