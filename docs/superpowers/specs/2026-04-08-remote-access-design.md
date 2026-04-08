# Remote Access — Design Spec

**Date:** 2026-04-08
**Status:** Approved

## Summary

Add a built-in web server to CmdCLD that allows remote control of Claude sessions from any device on the network (phone, tablet, another PC) via a browser. No cloud dependency — runs entirely on the home PC, reachable via Tailscale or LAN.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Express + Socket.IO in Electron main process | Proven stack, Socket.IO handles reconnection for flaky mobile connections |
| Folder selection | Favorites + recents | Recents already exist in SQLite; favorites are a small addition. Avoids typing paths on mobile |
| Output view | Dashboard summary cards → tap for full terminal | Quick glance at all sessions, drill in when needed |
| Input (desktop) | Full xterm.js terminal | Same experience as the Electron app |
| Input (mobile) | Quick action buttons + text input | Touch-friendly; buttons for common commands (yes, no, Ctrl+C, /compact, /clear) |
| Auth | None | Tailscale network is already private; LAN access is trusted |
| Binding | `0.0.0.0` (all interfaces) | Reachable on Tailscale and LAN; most flexible |
| Remote UI tech | Vanilla HTML/CSS/JS SPA, no framework | No second build pipeline; static files served by Express |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 MAIN PROCESS                     │
│                                                  │
│  Existing:                                       │
│  ├─ PtyManager (PTY sessions)                    │
│  ├─ Store / Settings / RecentDB                  │
│  └─ IPC Handlers (renderer ↔ main)               │
│                                                  │
│  New:                                            │
│  └─ RemoteServer                                 │
│     ├─ Express (REST API + static files)         │
│     ├─ Socket.IO (live terminal streaming)       │
│     └─ Taps into PtyManager, Settings, RecentDB  │
│                                                  │
└─────────────────────────────────────────────────┘
         ↑ IPC ↓              ↑ HTTP/WS ↓
    [Renderer/UI]         [Remote Browser Client]
```

`RemoteServer` is a new class in `src/main/remote-server.ts`. It receives references to `PtyManager`, `Settings`, and `RecentDB` — no duplication, it reads/writes the same state the Electron UI does.

## PtyManager Refactor

`PtyManager` currently sends data directly to `WebContents` via IPC. To allow `RemoteServer` to also subscribe to PTY events, PtyManager gains `EventEmitter`:

```typescript
class PtyManager extends EventEmitter {
  // Existing methods unchanged
  // New events emitted alongside existing webContents.send() calls:
  this.emit('data', { id, data })
  this.emit('exit', { id, exitCode })
  this.emit('created', { id, meta })
}
```

This is additive — existing IPC flow is untouched.

## Settings

New fields in `AppSettings`:

```typescript
remoteAccess: boolean      // Toggle on/off (default: false)
remotePort: number         // Server port (default: 3456)
favoriteFolders: string[]  // Folders shown in remote UI for new sessions
```

Settings dialog gets a new "Remote Access" section:
- Toggle switch: Enable Remote Access
- Port number input
- When enabled, displays reachable URLs (LAN IP, Tailscale IP if available)
- Favorite folders list (add/remove)

`RemoteServer.start()` called when toggled on, `.stop()` when toggled off.

## REST API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/status` | App status (version, uptime, session count) |
| `GET` | `/api/sessions` | List all sessions (id, name, path, busy/idle, color) |
| `POST` | `/api/sessions` | Create new session `{ path, claudeArgs? }` |
| `DELETE` | `/api/sessions/:id` | Kill a session |
| `GET` | `/api/sessions/:id/scrollback` | Get buffered output for initial load |
| `GET` | `/api/folders/recent` | Recent folders from existing SQLite DB |
| `GET` | `/api/folders/favorites` | Favorite folders list |
| `PUT` | `/api/folders/favorites` | Update favorites list |
| `GET` | `/api/settings` | Get relevant settings (claudeArgs) |
| `POST` | `/api/sessions/:id/upload-image` | Upload image, save to `.screenshots/`, return path |

## Socket.IO Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `session:output` | Server → Client | Live terminal data `{ id, data }` |
| `session:exit` | Server → Client | Session ended `{ id, exitCode }` |
| `session:created` | Server → Client | New session appeared |
| `session:input` | Client → Server | Write to PTY `{ id, data }` |
| `session:resize` | Client → Server | Resize PTY `{ id, cols, rows }` |
| `sessions:changed` | Server → Client | Session list changed |

Client subscribes to all sessions by default. When opening a session's terminal view, scrollback is fetched via REST first, then live output streams via socket.

## Remote UI

Static SPA served by Express from `src/remote-ui/`:

```
src/remote-ui/
├── index.html      # SPA shell
├── style.css       # Responsive dark theme
├── app.js          # Dashboard, routing, Socket.IO client
├── terminal.js     # xterm.js setup for desktop terminal view
└── mobile.js       # Quick action buttons, mobile input
```

No framework, no build step. xterm.js and Socket.IO client loaded from node_modules.

### Dashboard View (landing page)
- Status bar: connection state, session count
- Session cards: name, path, busy/idle indicator, color accent
- Tap card → terminal view
- "New Session" button → folder picker (favorites + recents)

### Terminal View (session detail)
- Header: back button, session name, status, Ctrl+C button, Kill button
- Responsive breakpoint at ~768px:
  - **Desktop (≥768px):** Full xterm.js terminal with keyboard input
  - **Mobile (<768px):** Read-only terminal output display + quick action buttons (yes, no, Ctrl+C, /compact, /clear) + text input with send button
- Image upload: paste handler (Clipboard API) on desktop, file picker button on mobile

## Session Sync (Local ↔ Remote)

**Remote creates session:**
1. `POST /api/sessions` → `PtyManager.create()` 
2. `RemoteServer` subscribes to PTY data events
3. Socket.IO emits `session:created` to remote clients
4. Main process sends IPC `session:created-remote` to renderer → terminal appears in local Electron UI

**Local creates session:**
1. Renderer IPC `pty:create` → `PtyManager.create()` (existing flow)
2. `PtyManager` emits `created` event
3. `RemoteServer` picks it up → Socket.IO emits `session:created` to remote clients

**Terminal I/O:**
- PTY output → `PtyManager` emits `data` → `RemoteServer` → Socket.IO `session:output` to clients
- Remote input → Socket.IO `session:input` → `PtyManager.write()` → PTY
- Local input → existing IPC path, unchanged

**Sitting down at the local PC:** All sessions (remote-created or local) are visible in the Electron UI with full scrollback. No output is lost.

## Image Paste (Remote)

- Desktop browser: Clipboard API intercepts paste → reads image blob → `POST /api/sessions/:id/upload-image` → server saves to `.screenshots/` in project folder → returns file path → client sends path as terminal input
- Mobile browser: Same Clipboard API + additional camera/file picker button in input bar → same upload flow

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network drop / sleep | Socket.IO auto-reconnects; client shows "Reconnecting..." banner; on reconnect fetches scrollback to fill gap |
| Remote client disconnects | No impact — PTY keeps running, scrollback buffers |
| Multiple remote clients | All see same sessions/output; input from any client goes to PTY |
| Client disconnected when session created | `GET /api/sessions` on reconnect refreshes list |
| Port in use | `RemoteServer.start()` catches `EADDRINUSE`, reports to settings UI |
| Server toggled off while clients connected | Clients disconnected, see "Connection lost" |

## Dependencies (New)

- `express` — HTTP server + routing
- `socket.io` — WebSocket with auto-reconnection
- `@xterm/addon-attach` or `@xterm/addon-web-links` (already present) — for remote xterm.js

Socket.IO client + xterm.js are served from node_modules by Express (e.g. `/vendor/socket.io.js`, `/vendor/xterm.js`) so the remote UI has zero external CDN dependencies.

## Files Changed/Created

**New files:**
- `src/main/remote-server.ts` — RemoteServer class
- `src/remote-ui/index.html` — SPA shell
- `src/remote-ui/style.css` — Responsive styles
- `src/remote-ui/app.js` — Dashboard + routing + Socket.IO
- `src/remote-ui/terminal.js` — xterm.js terminal view
- `src/remote-ui/mobile.js` — Mobile quick actions + input

**Modified files:**
- `src/main/pty-manager.ts` — Add EventEmitter, emit data/exit/created events
- `src/main/settings.ts` — Add remoteAccess, remotePort, favoriteFolders fields
- `src/main/index.ts` — Instantiate RemoteServer, wire to PtyManager/Settings/RecentDB, handle toggle IPC
- `src/preload/index.ts` — Expose `session:created-remote` listener
- `src/renderer/src/App.tsx` — Listen for remote-created sessions, add to state
- `src/renderer/src/components/SettingsDialog.tsx` — Remote Access settings section
- `package.json` — Add express, socket.io dependencies
