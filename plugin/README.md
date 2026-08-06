# cmdcld-exchange plugin

Bundles the cross-project **exchange** skill (the docs/integration request/response
protocol, CMDCLD-REQ-001) with the MCP config for CmdCLD's session relay
(`relay_notify`, `list_sessions`).

## Install (once per machine)

```
claude plugin marketplace add D:\Source\i60\CmdCLD
claude plugin install cmdcld-exchange@cmdcld
```

## Updating after a skill change

The installed plugin is a **snapshot** taken at install time into
`~/.claude/plugins/cache/cmdcld/cmdcld-exchange/<version>/`, keyed by the `version` in
`.claude-plugin/plugin.json`. Editing `skills/exchange/SKILL.md` does not refresh it,
and neither does re-invoking the skill. So when the skill changes materially:

```
# bump "version" in plugin/.claude-plugin/plugin.json first, then:
claude plugin marketplace update cmdcld
claude plugin update cmdcld-exchange@cmdcld
```

Once per machine, not per session — the cache is shared. Then **restart** each running
session; the update reports `Restart to apply changes` and means it. Without the
version bump the marketplace refresh finds nothing to do, which is how every session on
this machine ran the pre-amendment protocol from 2026-08-03 to 2026-08-06.

## How it connects

CmdCLD injects two environment variables into every pty it spawns:

- `CMDCLD_RELAY_URL` — the localhost-only MCP endpoint (default port 4664).
- `CMDCLD_SESSION_ID` — an opaque per-session token; the host maps it back to the
  session so `relay_notify`'s sender name is host-stamped, never client-supplied.

Sessions launched outside CmdCLD lack both; the relay tools fail gracefully there,
and the `exchange` skill still works (the document protocol needs no host).
