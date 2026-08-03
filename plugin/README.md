# cmdcld-exchange plugin

Bundles the cross-project **exchange** skill (the docs/integration request/response
protocol, CMDCLD-REQ-001) with the MCP config for CmdCLD's session relay
(`relay_notify`, `list_sessions`).

## Install (once per machine)

```
claude plugin marketplace add D:\Source\i60\i60.CmdCLD
claude plugin install cmdcld-exchange@cmdcld
```

## How it connects

CmdCLD injects two environment variables into every pty it spawns:

- `CMDCLD_RELAY_URL` — the localhost-only MCP endpoint (default port 4664).
- `CMDCLD_SESSION_ID` — an opaque per-session token; the host maps it back to the
  session so `relay_notify`'s sender name is host-stamped, never client-supplied.

Sessions launched outside CmdCLD lack both; the relay tools fail gracefully there,
and the `exchange` skill still works (the document protocol needs no host).
