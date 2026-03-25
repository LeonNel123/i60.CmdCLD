# CmdCLD — Multi-Terminal Claude Launcher

## Overview

A Windows desktop app that lets you manage multiple interactive Claude CLI sessions side by side. You pick folders, each one gets a full terminal running `claude --dangerously-skip-permissions`, and the terminals tile in a draggable/resizable grid with color-coded borders.

## Tech Stack

- **Electron** — Desktop shell
- **node-pty** — PTY spawning (Windows ConPTY)
- **xterm.js** + `@xterm/addon-fit` — Terminal rendering + auto-resize
- **React** + **react-dom** — UI framework
- **react-grid-layout** — Draggable/resizable grid panels
- **electron-vite** — Build tooling (Vite + Electron + React scaffold)
- **Plain JSON file** — Persistence (`%APPDATA%/cmdcld/sessions.json`)

## UI Design

### Top Bar
- App title ("CmdCLD") with session count
- "+ Add Folder" button (opens native Windows folder picker)

### Terminal Grid
- Auto-layout based on terminal count:
  - 1 → fullscreen
  - 2 → side by side (1×2)
  - 3-4 → 2×2
  - 5-6 → 2×3 or 3×2
  - 7-8 → 2×4 or adaptive
- Panels are draggable (reorder) and resizable (drag borders)
- User layout overrides persist across sessions

### Terminal Panels
- Each panel has a colored border (random unique color from a pool)
- Header bar: folder name label + ✕ close button, tinted with the panel's color
- Body: full xterm.js interactive terminal
- Dark background, monospace font

### Interactions
- **Add folder:** Click "+" → native folder picker → new terminal spawns with `claude --dangerously-skip-permissions` in that directory
- **Close terminal:** Click ✕ → confirmation dialog → kills PTY, removes panel, updates saved state
- **Claude exits:** Terminal stays open showing exit status, user can type new commands or close
- **Resize/drag:** Panels can be freely rearranged and resized

## Architecture

### Process Model

```
Main Process (Electron)
├── Window management
├── PTY Manager (node-pty)
│   ├── Spawns one PTY per folder
│   ├── Pipes data to/from renderer via IPC
│   └── Handles process lifecycle (spawn, kill, exit)
└── Store (sessions.json)
    ├── Folder paths
    ├── Panel layout (positions, sizes)
    └── Assigned colors

Renderer Process (React)
├── App.tsx — Grid layout manager
├── TopBar.tsx — Header with + button
├── TerminalPanel.tsx — xterm.js + colored header
├── ConfirmDialog.tsx — Close confirmation
└── usePty.ts hook — Connects xterm ↔ PTY via IPC
```

### IPC Flow

```
Main Process                    Renderer Process
─────────────                   ─────────────────
node-pty spawn ──── data ────→  xterm.js write
                 ←── input ──── xterm.js onData
                 ←── resize ─── xterm.js onResize
pty exit event ──── exit ────→  show exit status
folder dialog  ──── result ──→  add new panel
```

### Preload Bridge

The preload script exposes a safe API to the renderer:
- `pty.create(folderPath)` → returns terminal ID
- `pty.write(id, data)` → sends input to PTY
- `pty.resize(id, cols, rows)` → resizes PTY
- `pty.kill(id)` → kills PTY process
- `pty.onData(id, callback)` → receives PTY output
- `pty.onExit(id, callback)` → receives exit notification
- `dialog.selectFolder()` → opens native folder picker
- `store.load()` / `store.save(state)` → persistence

## Persistence

File: `%APPDATA%/cmdcld/sessions.json`

```json
{
  "folders": [
    {
      "path": "C:\\Projects\\my-web-app",
      "color": "#f472b6",
      "gridPosition": { "x": 0, "y": 0, "w": 6, "h": 1 }
    }
  ],
  "windowBounds": { "width": 1400, "height": 900, "x": 100, "y": 100 }
}
```

On app launch: read file, restore window bounds, spawn terminals for each folder, restore grid layout.
On any change: write updated state.

## Color System

A pool of 12+ distinct, high-contrast colors. When a folder is added, pick a random color not already in use. Colors are assigned to:
- Panel border (2px solid)
- Header background (subtle tint)
- Folder name text

## Project Structure

```
i60.CmdCLD/
├── package.json
├── electron.vite.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts           # App entry, window creation
│   │   ├── pty-manager.ts     # Spawns/manages node-pty instances
│   │   └── store.ts           # Persistence
│   ├── preload/
│   │   └── index.ts           # IPC bridge
│   └── renderer/
│       ├── App.tsx             # Main layout, grid management
│       ├── components/
│       │   ├── TopBar.tsx
│       │   ├── TerminalPanel.tsx
│       │   └── ConfirmDialog.tsx
│       ├── hooks/
│       │   └── usePty.ts
│       └── utils/
│           └── colors.ts
├── resources/                  # App icon
└── electron-builder.yml
```

## Scope Boundaries

**In scope:**
- Windows support only (for now)
- 1-8 simultaneous terminals
- Folder persistence and layout persistence
- Auto-launch `claude --dangerously-skip-permissions` per terminal
- Draggable/resizable panels with colored borders

**Out of scope:**
- macOS/Linux support
- Custom command configuration (always launches Claude with skip permissions)
- Terminal tabs or stacking (grid only)
- Settings/preferences UI
- Auto-updates
