# cmdcld-exchange plugin

Bundles the cross-project **exchange** skill (the docs/integration request/response
protocol, CMDCLD-REQ-001) with the MCP config for CmdCLD's session relay
(`relay_notify`, `list_sessions`).

## Install (once per machine)

```
claude plugin marketplace add https://github.com/dewald-behm/i60.CmdCLD.git#wip-dewald
claude plugin install cmdcld-exchange@cmdcld
```

The marketplace is the **repo on GitHub**, not a checkout — sessions on other projects
and other machines can install and refresh without `D:\Source\i60\i60.CmdCLD` existing.
Until 1.2.0 the source was that local directory and the skill told every reader to open
its `SKILL.md` directly, which no counterpart outside this machine could do.

The `#wip-dewald` suffix pins the branch and is the whole reason the URL form is needed:
`plugin/` and `.claude-plugin/` live only on that branch, so the `owner/repo` shorthand
would clone `master` and find no catalog. **When the plugin lands on `master` via PR,
drop the suffix** and re-add as `dewald-behm/i60.CmdCLD` — and say so in an exchange
document, since installed copies do not learn it by themselves.

Add `--sparse .claude-plugin plugin` to clone only what the marketplace needs, if the
full checkout is unwelcome.

Then enable auto-update: `/plugin` → **Marketplaces** → `cmdcld` → *Enable auto-update*.
Only official Anthropic marketplaces get it by default; third-party and local ones never
refresh themselves until you toggle it, which is why this machine's entry showed
`"lastUpdated": "2026-07-30"` while the skill was amended twice. With it on, Claude Code
pulls new versions in the background shortly after session start and applies them on
`/reload-plugins` or at next launch — no manual `update` pair. It does **not** replace
the version bump below: auto-update compares versions, not content.

To develop against the working tree instead, add the directory as a second marketplace
(`claude plugin marketplace add D:\Source\i60\i60.CmdCLD`) under a different name —
`marketplace remove` uninstalls the plugins that came from it, so don't swap the shared
one back and forth.

## Updating after a skill change

The installed plugin is a **snapshot** taken at install time into
`~/.claude/plugins/cache/cmdcld/cmdcld-exchange/<version>/`, keyed by the `version` in
`.claude-plugin/plugin.json`. Editing `skills/exchange/SKILL.md` does not refresh it,
and neither does re-invoking the skill. So when the skill changes materially:

```
# 1. bump "version" in plugin/.claude-plugin/plugin.json
# 2. bump the "Protocol version" stamp at the top of skills/exchange/SKILL.md to match
# 3. commit and PUSH the branch the marketplace is pinned to — a git-hosted
#    marketplace refreshes from the remote, so an unpushed commit changes nothing
claude plugin marketplace update cmdcld
claude plugin update cmdcld-exchange@cmdcld
```

Once per machine, not per session — the cache is shared. Then **restart** each running
session; the update reports `Restart to apply changes` and means it. Without the
version bump the marketplace refresh finds nothing to do, which is how every session on
this machine ran the pre-amendment protocol from 2026-08-03 to 2026-08-06.

The version stamp in `SKILL.md` is what makes staleness detectable from the served text
alone: a session whose stamp is older than the version a document cites knows to
refresh, without reading anything on disk.

## How it connects

CmdCLD injects two environment variables into every pty it spawns:

- `CMDCLD_RELAY_URL` — the localhost-only MCP endpoint (default port 4664).
- `CMDCLD_SESSION_ID` — an opaque per-session token; the host maps it back to the
  session so `relay_notify`'s sender name is host-stamped, never client-supplied.

Sessions launched outside CmdCLD lack both; the relay tools fail gracefully there,
and the `exchange` skill still works (the document protocol needs no host).
