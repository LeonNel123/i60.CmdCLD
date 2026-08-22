# CmdCLD

A desktop terminal manager for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and Codex CLI sessions simultaneously. Built with Electron, React, and xterm.js.

Open multiple project folders, each running its own Claude or Codex CLI instance in a resizable grid or focused full-screen view. Switch between projects instantly, spawn plain shells, paste screenshots directly into conversations, and manage everything from a compact sidebar.

## Features

**Multi-Terminal Grid**
- Open multiple Claude or Codex CLI sessions side-by-side in an auto-arranging grid
- Switch to focused mode (one terminal full-screen) via the sidebar
- Drag to rearrange, resize panels freely
- Smart layout: 2 terminals = full-height columns, 4 = 2x2 grid, etc.

**Sidebar Navigation**
- Collapsible sidebar with folder list, recent folders (SQLite-backed), and quick actions
- Click a folder to focus it, "Show All" to return to grid
- Busy/idle indicators: dots pulse when an agent is working

**Terminal Features**
- Ctrl+V paste with clipboard image support (screenshots saved to `.screenshots/` in your project)
- Ctrl+F search through terminal scrollback
- Ctrl+=/- font zoom (Ctrl+0 to reset)
- Clickable URLs (open in browser) and file paths (open in editor)
- Clickable `.md` files open in a built-in rendered markdown viewer
- VS Code Dark+ color theme

**Quick Actions (Terminal Header)**
- `>_` Open a plain shell for the same folder (for npm, git, builds)
- Pencil icon: Open folder in your configured editor
- Folder icon: Open in file explorer
- Right-click to switch between installed editors

**Remote Access**
- Access your Claude or Codex sessions from any device on your network (phone, tablet, another PC)
- Enable from Settings — starts an Express + Socket.IO server on a configurable port
- Dashboard shows all active sessions with busy/idle status
- Create new sessions from favorite or recent folders remotely
- Full terminal on desktop browsers, read-only output + quick buttons on mobile
- Paste or upload images from remote devices
- Auto-discovers local network IPs and Tailscale addresses
- Includes a setup guide for Tailscale-based access from anywhere

**Settings**
- Configurable Claude and Codex CLI launch arguments with provider-specific quick presets
- Default agent CLI selector with installed CLI availability detection
- "Ask before launch" mode: edit flags each time you open a folder
- Default view mode: grid or focused
- Notification sound when terminal finishes work (toggle on/off)
- Auto-detect installed editors (VS Code, Cursor, Windsurf, Visual Studio, IntelliJ, etc.)
- Projects root for one-click new project creation
- App version displayed in settings dialog

**Keyboard Shortcuts**
| Shortcut | Action |
|----------|--------|
| Ctrl+1-9 | Switch to terminal by index |
| Ctrl+T | Add folder |
| Ctrl+` | Show all (grid view) |
| Ctrl+F | Search in terminal |
| Ctrl+=/- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| Ctrl+End | Scroll terminal to bottom (no input sent) |

**Other**
- Always starts with a blank slate (no session restore)
- Close All button to kill all terminals at once
- Single instance lock (second launch focuses existing window)
- Multi-window support (new windows start empty)
- Recent folders remembered across sessions (last 20)
- PowerShell 7 (`pwsh`) used when available, falls back to Windows PowerShell
- Cross-platform shell detection (bash/zsh on Mac/Linux)
- Window bounds saved and restored

## Autopilot

Autopilot drives the CLI agent in a terminal towards a goal without you sitting on the
Enter key. You describe what you want; an orchestrator watches the agent's output, answers
it each time it stops, and keeps going until the work is done, the money runs out, or it
gets stuck and says so.

It comes in three flavours. They all do the same fundamental thing — the difference is how
much gets written down before code happens, and how many agents are involved.

| | Classic | PRO | Council |
|---|---|---|---|
| **Shape** | one goal, split into milestones | staged: spec → plan → build → review | one agent builds, a second reviews |
| **Agents** | 1 | 1 | 2 |
| **Starts** | immediately | after you approve a spec and plan | immediately |
| **Cost** | lowest | higher — more planner calls | roughly double — two agents |
| **Leaves behind** | `.autopilot/` | `.autopilot-pro/` incl. spec.md, plan.md, reviews | `.autopilot-council/` |
| **Reach for it when** | you know what needs doing | getting the approach wrong is expensive | a second opinion beats speed |

### Classic — one goal, milestone by milestone

Describe a goal. The agent breaks it into milestones and works through them, checking in as
each one lands. Nothing is specified up front, so it starts fastest and leaves the least
behind. Good for a task you understand that fits in one sitting.

### PRO — spec first, then plan, then code

Runs in stages: discovery, planning, implementation, a review after each phase, then a
final review. It writes `spec.md` and a phased `plan.md` and waits for both to be approved
before any code is written — so you can read the intent and correct it while it is still
cheap to change. Slower to start, and it makes a planner call per turn, so it costs more.
Worth it when you want a record of why the code looks the way it does, or when the wrong
approach would be expensive to unwind. Both artifacts are plain markdown in
`.autopilot-pro/` and are worth reading while the run is going.

### Council — one agent writes, another reviews

Two CLI sessions: an implementer, and a separate reviewer that inspects the work at fixed
gates and can send it back for another pass. You need a second agent available, it takes
longer, and it costs about twice as much. The intensity setting (light / balanced / strict)
controls how readily the reviewer blocks. Reach for it when a second opinion matters more
than throughput.

### Running one, and stopping one

Start from the terminal header (the robot icon) and pick a mode — the dialog has a
**Which should I use?** guide if you want the comparison in front of you. If you have run
that mode in this folder before, it offers to resume rather than start over.

While a run is going, the Autopilot panel shows the current stage, what the agent last
said, and what has been spent. You can pause, resume, stop, or type a reply by hand when
the run asks you something.

A run ends by itself in four ways: it finishes, it hits the cost cap you set, the agent
goes quiet for too long, or it gets stuck and escalates. The last three are one-way — the
panel tells you what happened, and the next move is yours. Stopping is always safe.

Autopilot never edits your files itself; only the agent does, exactly as it would if you
were typing. `git status` and `git diff` remain the honest record of what a run actually
did, and a branch before you start is the cheapest insurance there is.

## Download

Prebuilt installers for every release are attached to the
[latest release](https://github.com/LeonNel123/i60.CmdCLD/releases/latest) — no toolchain
or build step required.

| Platform | File |
| --- | --- |
| Windows | `CmdCLD-Setup-<version>.exe` |
| macOS (Apple Silicon) | `CmdCLD-<version>-arm64.dmg` |
| macOS (Intel) | `CmdCLD-<version>-x64.dmg` |

### First launch

The builds are **not code-signed**, so both operating systems warn on first run. The
binaries are built in public by [GitHub Actions](.github/workflows/release.yml) from the
tagged commit, so you can check the build log for any release.

**Windows** — SmartScreen shows *"Windows protected your PC"*. Click **More info**, then
**Run anyway**.

**macOS** — Gatekeeper usually reports the app as *"damaged and can't be opened"*. It is
not damaged; that is the message for an unsigned app carrying the download quarantine
flag. Clear it once after dragging to Applications:

```bash
xattr -cr /Applications/CmdCLD.app
```

## Getting Started

```bash
git clone https://github.com/LeonNel123/i60.CmdCLD.git
cd i60.CmdCLD
npm install
npm run dev
```

### Build Installer

```bash
npm run package:win      # Windows (NSIS installer)
npm run package:mac      # macOS (DMG)
npm run package:linux    # Linux (AppImage)
```

### Cut a Release

```bash
npm run release:tag      # bump patch version, commit, tag, push
```

Pushing the tag runs the release workflow, which builds Windows and macOS installers on
their native runners and attaches them to the GitHub Release. Nothing needs to be built
by hand on a Mac.

### Run Tests

```bash
npm test
```

## Tech Stack

- **Electron** — desktop app framework
- **React 18** — UI
- **xterm.js** — terminal emulation (with search, web-links, fit addons)
- **node-pty** — pseudo-terminal for shell processes
- **react-grid-layout** — draggable/resizable grid
- **sql.js** — SQLite for recent folders (pure JS, no native build needed)
- **marked** — markdown rendering
- **Express** — remote access HTTP server
- **Socket.IO** — real-time terminal streaming for remote clients
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
    remote-server.ts    # Express + Socket.IO remote access server
  preload/        # IPC bridge (context isolation)
    index.ts
  renderer/       # React frontend
    src/
      App.tsx           # Main app component
      components/
        TerminalPanel.tsx   # xterm.js terminal with all features
        Sidebar.tsx         # Navigation sidebar
        SettingsDialog.tsx  # Settings UI
        LaunchDialog.tsx    # Agent CLI args picker
        MarkdownViewer.tsx  # Rendered markdown viewer
        ConfirmDialog.tsx   # Confirmation dialog
      utils/
        terminal-activity.ts  # Busy/idle tracking
        grid-layout.ts       # Grid layout calculator
        colors.ts             # Terminal color assignment
  shared/
    agent-cli.ts          # Agent CLI provider model and presets
  remote-ui/      # Browser-based remote client
    index.html        # Dashboard (session cards, new session modal)
    app.js            # Socket.IO connection, session management
    terminal-view.js  # xterm.js terminal + mobile fallback
    style.css         # Responsive styling
    setup.html        # Tailscale setup guide
tests/            # Unit tests (vitest)
```

## License

MIT
