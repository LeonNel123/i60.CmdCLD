# CmdCLD

A desktop terminal manager for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions simultaneously. Built with Electron, React, and xterm.js.

Open multiple project folders, each running its own Claude CLI instance in a resizable grid or focused full-screen view. Switch between projects instantly, spawn plain shells, paste screenshots directly into conversations, and manage everything from a compact sidebar.

## Features

**Multi-Terminal Grid**
- Open multiple Claude CLI sessions side-by-side in an auto-arranging grid
- Switch to focused mode (one terminal full-screen) via the sidebar
- Drag to rearrange, resize panels freely
- Smart layout: 2 terminals = full-height columns, 4 = 2x2 grid, etc.

**Sidebar Navigation**
- Collapsible sidebar with folder list, recent folders (SQLite-backed), and quick actions
- Click a folder to focus it, "Show All" to return to grid
- Busy/idle indicators: dots pulse when Claude is working

**Terminal Features**
- Ctrl+V paste with clipboard image support (screenshots saved to `.screenshots/` in your project)
- Ctrl+F search through terminal scrollback
- Ctrl+=/- font zoom (Ctrl+0 to reset)
- Clickable URLs (open in browser) and file paths (open in editor)
- Clickable `.md` files open in a built-in rendered markdown viewer
- Auto-clear terminal when Claude CLI exits
- VS Code Dark+ color theme

**Quick Actions (Terminal Header)**
- `>_` Open a plain shell for the same folder (for npm, git, builds)
- Pencil icon: Open folder in your configured editor
- Folder icon: Open in file explorer
- Right-click to switch between installed editors

**Settings**
- Configurable Claude CLI launch arguments with quick presets (Skip Permissions, Auto Mode, Plan Mode, etc.)
- "Ask before launch" mode: edit flags each time you open a folder
- Default view mode: grid or focused
- Notification sound when terminal finishes work (toggle on/off)
- Auto-detect installed editors (VS Code, Cursor, Windsurf, Visual Studio, IntelliJ, etc.)
- Projects root for one-click new project creation

**Keyboard Shortcuts**
| Shortcut | Action |
|----------|--------|
| Ctrl+1-9 | Switch to terminal by index |
| Ctrl+T | Add folder |
| Ctrl+` | Show all (grid view) |
| Ctrl+F | Search in terminal |
| Ctrl+=/- | Zoom in/out |
| Ctrl+0 | Reset zoom |

**Other**
- Single instance lock (second launch focuses existing window)
- Multi-window support (new windows start empty)
- Recent folders remembered across sessions (last 20)
- PowerShell 7 (`pwsh`) used when available, falls back to Windows PowerShell
- Window bounds saved and restored

## Requirements

- Windows 10/11
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js 18+ (for building from source)

## Install

Download the latest `CmdCLD-Setup.exe` from [Releases](../../releases) and run it. One-click install, no admin required.

## Build from Source

```bash
git clone https://github.com/user/cmdcld.git
cd cmdcld
npm install
npm run dev        # development with hot reload
npm run build      # production build
npm run test       # run tests
npm run package    # create installer (dist/CmdCLD-Setup.exe)
```

## Tech Stack

- **Electron** — desktop app framework
- **React 18** — UI
- **xterm.js** — terminal emulation (with search, web-links, fit addons)
- **node-pty** — pseudo-terminal for shell processes
- **react-grid-layout** — draggable/resizable grid
- **sql.js** — SQLite for recent folders (pure JS, no native build needed)
- **marked** — markdown rendering
- **electron-builder** — packaging and installer

## Project Structure

```
src/
  main/           # Electron main process
    index.ts        # App lifecycle, IPC handlers, window management
    pty-manager.ts  # PTY process management with scrollback buffers
    store.ts        # Session state persistence (JSON)
    recent-db.ts    # Recent folders database (SQLite)
    settings.ts     # User settings
    window-registry.ts  # Multi-window tracking
    editor-detect.ts    # Auto-detect installed editors
  preload/        # IPC bridge (context isolation)
    index.ts
  renderer/       # React frontend
    src/
      App.tsx           # Main app component
      components/
        TerminalPanel.tsx   # xterm.js terminal with all features
        Sidebar.tsx         # Navigation sidebar
        SettingsDialog.tsx  # Settings UI
        LaunchDialog.tsx    # Claude args picker
        MarkdownViewer.tsx  # Rendered markdown viewer
        ConfirmDialog.tsx   # Confirmation dialog
      utils/
        terminal-activity.ts  # Busy/idle tracking
        grid-layout.ts       # Grid layout calculator
        claude-presets.ts     # CLI argument presets
        colors.ts             # Terminal color assignment
tests/            # Unit tests (vitest)
```

## License

MIT
