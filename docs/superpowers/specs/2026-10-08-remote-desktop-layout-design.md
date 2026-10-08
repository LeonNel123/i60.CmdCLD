# Remote desktop layout — design

Date: 2026-10-08
Status: approved in conversation, awaiting spec review

## Goal

When the user connects to CmdCLD remotely from a laptop or tablet, the browser
shows the same workspace as the desktop app: sessions tiled in the auto grid
(1 / 2x1 / 3x1 / 2x2 / 3x2 / 3xN), a focused mode that fills the area with one
session, minimize to a taskbar, the collapsible sidebar, and drag/resize of
tiles. Phones keep the current card list and single-terminal view.

## Decisions already made

- **One user at a time.** The app is used from the desktop or remotely, never
  both at once. The active device owns PTY size. The server's existing
  "last fit wins" resize relay is therefore the correct behaviour and is kept.
- **Scope: everything.** Grid, focus, minimize, sidebar, drag and resize.
- **Approach A: ship the desktop renderer to the browser.** The React renderer
  is built a second time as a browser bundle, with a transport adapter standing
  in for the Electron preload bridge. Reimplementing the layout in the plain-JS
  remote UI was rejected as a second copy that would drift.
- **Phones unchanged.** Below 769 px the existing `src/remote-ui` flow is used.

## Architecture

```
browser (>=769px)  ──GET /desktop──▶  remote-server  ──serves──▶  out/renderer/remote.html
                                         │                          (React App + remote-api.ts)
                                         │
browser (<769px)   ──GET /────────▶      │ ──serves──▶  src/remote-ui (unchanged)
                                         │
                   ◀──socket.io / REST──▶ │ ──calls──▶  pty-manager, settings, recent-db
```

### Build

- Add a second HTML entry to the existing electron-vite renderer config:
  `src/renderer/remote.html`. Its entry script, `src/renderer/src/remote-main.tsx`,
  installs the adapter as `window.api` and then mounts the same `App` component
  that `main.tsx` mounts.
- Vite multi-entry output lands in `out/renderer` next to the desktop bundle.
  electron-builder already packages everything under `out/`.
- Dev: electron-vite's dev server serves the renderer; the remote server
  proxies `/desktop` to it (same pattern as the existing node_modules fallback
  for xterm in dev).

### Serving and redirect

- Production: the remote server mounts `out/renderer` under `/desktop` and
  serves `remote.html` for the bare path. Asset URLs are relative so the
  prefix works unchanged.
- `/` (existing remote UI) adds a check at script start: viewport width
  >= 769 px and no `?mobile` flag → redirect to `/desktop`.
- `/desktop` does the reverse: width < 769 px and no `?desktop` flag →
  redirect to `/`.
- Either flag is persisted in `localStorage` so the choice sticks.
- The threshold 769 px matches `isMobile()` in `terminal-view.js`.

### Transport adapter — `src/renderer/src/remote-api.ts`

One object with the same shape as the preload bridge, plus `remote: true`.
It opens one Socket.IO connection and fans `session:output`, `session:exit`
and `session:resize` out to per-terminal subscribers, mirroring what the
preload does with IPC events.

| Group | Calls | Backing |
|---|---|---|
| Terminal lifecycle | createTerminal, writeTerminal, resizeTerminal, killTerminal, getScrollback, terminalExists, terminalListLive, onTerminalData/Exit/Resize | Existing socket events and REST. `POST /api/sessions` gains optional client `id`, `size`, `launchArgs`. `terminalListLive` maps to `GET /api/sessions` (all sessions — correct for a single-user remote). |
| Settings, recents, favorites | settingsGetAll, settingsSet, recentList/Add/Remove/CheckPath, favorites | Existing GET routes plus new `POST /api/settings`, `POST /api/folders/recent`, `GET /api/folders/check`. |
| Status | getHomeDir, getVersion, getBuildInfo, agentCliAvailability, gitStatus | Extend `GET /api/status`; new `GET /api/git/status`. |
| Session restore | sessionLoadLast, sessionSaveLast, sessionClearLast | Load → empty; save/clear → no-op. Remote rebuilds tiles from live sessions on boot (the desktop's post-reload path, which reuses server ids). Remote must never overwrite the desktop's `last-session.json`. |
| Clipboard | clipboardSaveImage, clipboardReadFiles, clipboardWriteText | Save image → existing `POST /api/sessions/:id/upload-image`. Read files → `[]`. Write text → browser clipboard with the hidden-textarea fallback already used by the remote UI (plain HTTP is not a secure context). |
| Folder picking | selectFolder | In-page path prompt (same interaction as the current remote modal). Returns the typed path or null. |
| Desktop only | openPath, openExternal, openInExplorer, openInEditor, editor*, windowCreate, windowList, onWindowCloseRequest, windowConfirmClose, adminShellMode, openAdminShell, projectCreate, terminalListExternal, terminalOpenExternal, autopilot*, broadcast*, prompts*, openrouterModels, aiUsageSummary, remote*, tailscale*, claudeConfig* | Stubs. Resolve with `undefined`, `false`, `[]`, `''` or `{}` as the type requires. Never reject. `onX` subscriptions return a no-op unsubscribe. |

### Why the create route accepts the renderer's id

The desktop renderer chooses a terminal id and passes it to main. The remote
server currently mints its own. Accepting the renderer's id keeps component
code unchanged and preserves the id-reuse path that stops a reload from
spawning a second agent (see CLAUDE.md, "Renderer recovery"). The id must be
a UUID and must not already exist; otherwise 400.

### Component edits

A handful of `if (window.api.remote)` hides, expected one line each:
new window, admin shell, open in explorer / editor, start autopilot,
broadcast toggle, external terminals. No layout, grid, sidebar, focus,
minimize, drag or resize code changes.

### Server routes

| Route | Change |
|---|---|
| `POST /api/sessions` | Accept optional `id` (UUID, must not exist), `size` ({cols, rows}), `launchArgs`. |
| `GET /api/sessions` | No change. |
| `POST /api/settings` | New. Calls the same validated setter the desktop IPC handler uses (`src/main/settings.ts`). |
| `POST /api/folders/recent` | New. Add a recent folder (path validated as an existing directory). |
| `GET /api/folders/check?path=` | New. `{ exists, isDirectory }`. |
| `GET /api/git/status?path=` | New. Wraps the helper the desktop `git:status` IPC handler uses. |
| `GET /api/status` | Extend with `homeDir`, `version`, `buildInfo`. |

Every route calls the same main-process function its IPC twin calls — one
implementation per behaviour.

### Security

- All new routes sit behind the existing loopback bind and Host/Origin gate in
  `remote-guard.ts`; LAN access remains an explicit setting.
- No open-path / open-external / open-in-editor route is added: those would
  let a remote page launch arbitrary programs on the host.
- `POST /api/settings` can change launch arguments, which is the same power the
  existing create route already grants.
- Path inputs reuse the directory validation the create route already does.

### Error handling

- **Disconnect / reconnect.** Adapter tracks socket state. On reconnect it
  re-fetches the live list and replays scrollback for each open tile. Tiles
  render a dimmed header while disconnected.
- **Stale session.** A session the server no longer has gets the same exited
  state the desktop shows; the user closes it normally.
- **Stubs resolve, never reject.** No unhandled rejections from awaited stubs.
- **Rejected create.** Server error message is surfaced; the adapter rejects so
  the terminal panel's existing close-on-failure path runs.

## Testing

Unit (vitest, under `tests/`):

1. **Adapter fan-out** — fake socket; output/resize reach only the matching
   id's subscriber; unsubscribe stops delivery.
2. **Adapter mapping** — each terminal call issues the expected emit or fetch;
   table-driven test over the stub group: every function resolves, none throws.
3. **Server routes** — supertest against the Express app: create accepts id
   and rejects duplicates/non-UUIDs; settings validation; folder check; the
   Host/Origin gate still applies to new routes.
4. **Redirect rule** — pure function `(width, flags) → 'stay' | '/desktop' | '/'`
   tested at the 768/769 boundary and with each flag.

Manual, reported with output after implementation:

- Build; open `/desktop` from a second browser; confirm 1 / 2 / 3 / 2x2 / 3x2
  grid, focus toggle, minimize to taskbar, drag and resize.
- Resize a tile remotely → desktop tile follows; and the reverse.
- Phone-width window stays on `/`.

## Out of scope

- Autopilot, broadcast, prompt history, OpenRouter pickers remotely (hidden).
- Any change to the phone UI, mobile input path, or Tailscale serve logic.
- Multi-user / concurrent desktop + remote use.
