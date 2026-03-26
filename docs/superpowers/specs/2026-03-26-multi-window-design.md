# Multi-Window with Terminal Move/Split

## Overview

Add multi-window support to CmdCLD so terminals can be spread across monitors. Terminals can be moved between windows without restarting their PTY sessions. Each terminal also gets a context menu with "Open in VS Code". A collapsible sidebar provides folder navigation, focus mode, and all action buttons — eliminating the top bar entirely for maximum terminal space.

## Architecture

### Window Registry (Main Process)

The main process maintains a registry of all open BrowserWindows:

```ts
interface WindowEntry {
  id: string
  label: string        // "Window 1", "Window 2", etc.
  window: BrowserWindow
  bounds: Rectangle
}
```

- Window IDs are auto-generated UUIDs.
- Labels are assigned sequentially ("Window 1", "Window 2"...) and reused when windows close.
- The registry is the single source of truth for which windows exist.

### PTY Ownership (Main Process)

PtyManager currently sends data to a single `webContents`. This changes to support reassignment:

```ts
interface PtyEntry {
  process: IPty
  targetWindowId: string   // which window receives output
  terminalMeta: { id: string, path: string, name: string, color: string }
}
```

- `ptyManager.create()` now takes a `windowId` to associate the PTY with a window.
- `ptyManager.move(ptyId, targetWindowId)` reassigns the data listener to the target window's webContents.
- PTY process is never restarted during a move.

### Move Flow

1. Source renderer sends `terminal:move(terminalId, targetWindowId | 'new')` via IPC.
2. Main process handles it:
   - If `targetWindowId === 'new'`, create a new BrowserWindow and register it.
   - Call `ptyManager.move(terminalId, targetWindowId)` to redirect data output.
   - Send `terminal:receive` to target window with terminal metadata + any scrollback buffer.
   - Send `terminal:removed` to source window so it removes the panel.
3. Target renderer creates a new TerminalPanel, connects to the existing PTY data stream.
4. Source renderer removes the panel from its grid layout.

### Scrollback Transfer

When moving a terminal, the target window needs existing terminal content. Two options:

**Option A (Recommended): PTY buffer replay.** Before redirecting, main process stores the last N lines of PTY output per terminal (ring buffer, ~5000 lines). On move, sends the buffer to the target window before live data resumes.

**Option B: Serialize xterm state.** Source renderer serializes xterm's buffer and sends it. More accurate but complex.

Go with Option A for simplicity.

## UI Changes

### TopBar — Removed

The TopBar component is deleted. All its functionality moves into the sidebar.

### Sidebar (New Component)

A collapsible left sidebar that serves as the primary navigation and action hub.

**Expanded state (~180px wide):**

```
┌──────────────────┐
│ + Add Folder     │
│ + New Window     │
├──────────────────┤
│ ● project-alpha  │  ← colored dot matches terminal border
│ ● my-api         │
│ ● frontend       │
│ ● docs-site      │
│                  │
│                  │
├──────────────────┤
│ ▣ Show All       │
│ ◀ Collapse       │
└──────────────────┘
```

**Collapsed state (~36px wide, icon strip):**

```
┌────┐
│ +  │  ← Add folder
│ ⊞  │  ← New window
├────┤
│ ●  │  ← colored dots, click to focus
│ ●  │
│ ●  │
│ ●  │
│    │
├────┤
│ ▣  │  ← Show All
│ ▶  │  ← Expand
└────┘
```

**Behavior:**
- **Click a folder** → that terminal maximizes to fill the entire main area. All other terminals stay alive but are hidden. The selected folder gets a highlight/active indicator.
- **"Show All"** → returns to the grid layout showing all terminals.
- **Collapse/Expand** → toggles between full sidebar and icon strip. State persisted.
- **"+ Add Folder"** → opens folder picker, adds new terminal (same as current).
- **"+ New Window"** → creates a new BrowserWindow.
- **Tooltips** on collapsed icons show the folder name on hover.
- Sidebar background matches the app theme (`#0d1117` or similar dark).

**View modes tracked in App state:**

```ts
type ViewMode =
  | { type: 'grid' }                    // show all terminals in grid
  | { type: 'focused', terminalId: string }  // one terminal maximized
```

When `viewMode.type === 'focused'`:
- The selected terminal renders at 100% width/height of the main area (no grid).
- Other terminals are unmounted or hidden (PTYs stay alive via main process).
- Grid layout state is preserved so "Show All" restores exact positions.

When `viewMode.type === 'grid'`:
- Normal grid layout as today.

### Terminal Panel Title Bar

Add a pop-out button (`⧉`) next to the close button (`✕`):

```
[folder-name .................... ⧉ ✕]
```

- If only one window exists: clicking `⧉` pops the terminal to a new window.
- If multiple windows exist: clicking `⧉` shows a small dropdown with "New Window" and a list of other windows ("Window 1", "Window 2"...).

### Context Menu

Right-click on the drag handle shows:

| Item | Action |
|------|--------|
| Move to > New Window | Move terminal to a fresh window |
| Move to > Window N | Move terminal to existing window N (one entry per other window) |
| Open in VS Code | Run `code <folderPath>` |

Implementation: Use a simple React context menu component (no library needed). Position it at mouse coordinates, dismiss on click-outside or Escape.

### "Open in VS Code"

Main process handles `vscode:open(folderPath)`:

```ts
import { exec } from 'child_process'
exec(`code "${folderPath}"`)
```

Exposed via IPC through preload.

## IPC Additions

### Main Process Handlers (ipcMain.handle)

| Channel | Args | Description |
|---------|------|-------------|
| `window:create` | none | Create and register a new window. Returns `windowId`. |
| `window:list` | none | Returns `{ id, label }[]` of all windows except the caller. |
| `terminal:move` | `terminalId, targetWindowId \| 'new'` | Move a terminal to another window. |
| `vscode:open` | `folderPath` | Open folder in VS Code. |

### Renderer Events (webContents.send)

| Channel | Data | Description |
|---------|------|-------------|
| `terminal:receive` | `{ id, path, name, color, scrollback }` | A terminal has been moved to this window. |
| `terminal:removed` | `terminalId` | A terminal was moved away from this window. |
| `window:list-updated` | `{ id, label }[]` | Window list changed (for updating dropdowns/menus). |

### Preload Additions

```ts
windowCreate: () => ipcRenderer.invoke('window:create'),
windowList: () => ipcRenderer.invoke('window:list'),
moveTerminal: (id: string, targetWindowId: string) => ipcRenderer.invoke('terminal:move', id, targetWindowId),
openInVscode: (path: string) => ipcRenderer.invoke('vscode:open', path),
onTerminalReceive: (cb: (data: TerminalTransfer) => void) => /* listener */,
onTerminalRemoved: (cb: (id: string) => void) => /* listener */,
onWindowListUpdated: (cb: (windows: WindowInfo[]) => void) => /* listener */,
```

## State Persistence

### Store Changes

Currently stores a single session. Changes to store per-window state:

```ts
interface PersistedState {
  windows: Array<{
    id: string
    bounds: Rectangle
    sidebarCollapsed: boolean
    viewMode: 'grid' | { focused: string }  // focused stores folder path
    folders: Array<{
      path: string
      color: string
      layout: { x: number, y: number, w: number, h: number }
    }>
  }>
}
```

- On save: iterate all windows, collect their terminal lists and layouts.
- On restore: recreate each window with its bounds, then create terminals within each.
- If saved state has only one window (migration from old format), load normally.

## Component Changes

### PtyManager

- Add `scrollbackBuffers: Map<string, string[]>` — ring buffer per PTY (5000 lines).
- Append to buffer on every `onData`.
- Add `move(id, newWindowId)` method: swap the `webContents` target, send scrollback to new target.
- `create()` now takes `windowId` param.

### TerminalPanel

- Add `⧉` pop-out button in title bar.
- Add right-click handler on drag handle for context menu.
- Accept optional `initialScrollback` prop for moved terminals.
- On mount with scrollback: write scrollback to xterm before connecting live data.

### TopBar — Deleted

Remove `TopBar.tsx`. All functionality now lives in the Sidebar.

### Sidebar Component (New)

`src/renderer/src/components/Sidebar.tsx`

Props:
```ts
interface SidebarProps {
  terminals: TerminalEntry[]
  viewMode: ViewMode
  onSelectTerminal: (id: string) => void
  onShowAll: () => void
  onAddFolder: () => void
  onNewWindow: () => void
}
```

- Manages its own collapsed/expanded state (persisted to localStorage).
- Renders folder list with colored indicators.
- Active/focused terminal gets a highlight style.
- Buttons for Add Folder, New Window, Show All, Collapse toggle.

### App.tsx

- Remove TopBar, add Sidebar.
- Add `viewMode` state (`'grid' | { focused: terminalId }`).
- When focused: render only the selected TerminalPanel at full size (no grid).
- When grid: render ResponsiveGridLayout as before.
- Listen for `terminal:receive` — add a new terminal entry to state.
- Listen for `terminal:removed` — remove terminal entry from state.
- Listen for `window:list-updated` — keep window list in state for menus.
- Pass window list to TerminalPanel for the pop-out dropdown.

### ContextMenu Component (New)

Simple positioned overlay:
- Renders at mouse coordinates.
- Supports nested items (for "Move to >" submenu).
- Dismisses on click-outside, Escape, or item selection.
- No external library needed.

## Edge Cases

- **Moving the last terminal out of a window:** Window stays open (empty state with "Add Folder" prompt).
- **Closing a window with terminals:** All terminals in that window are killed (existing confirm dialog behavior, but confirm once for all).
- **Moving to a window that closes mid-move:** Main process checks window still exists before completing move. If gone, create a new window instead.
- **Rapid successive moves:** Moves are serialized per-terminal via the IPC handler (one at a time).

## Testing

- Unit tests for PtyManager.move() — verify data redirect.
- Unit tests for scrollback ring buffer.
- Unit tests for window registry add/remove/label assignment.
- Integration: move terminal, verify PTY data flows to new window.
