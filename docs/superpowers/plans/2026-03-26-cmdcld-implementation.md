# CmdCLD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app that manages multiple interactive Claude CLI terminal sessions in a draggable/resizable grid.

**Architecture:** Electron main process spawns PTY sessions via node-pty, bridges I/O to the renderer via IPC. Renderer uses React with xterm.js for terminal rendering and react-grid-layout for the draggable panel grid. State persists to a JSON file in %APPDATA%.

**Tech Stack:** Electron, node-pty, xterm.js, React 18, react-grid-layout, electron-vite, TypeScript, Vitest

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `electron.vite.config.ts` | Build config for main/preload/renderer |
| `tsconfig.json` | Root TS config with project references |
| `tsconfig.node.json` | TS config for main + preload |
| `tsconfig.web.json` | TS config for renderer |
| `src/main/index.ts` | Electron app entry: window creation, IPC handlers |
| `src/main/pty-manager.ts` | Spawns/manages node-pty instances |
| `src/main/store.ts` | Read/write sessions.json persistence |
| `src/preload/index.ts` | contextBridge IPC API |
| `src/renderer/index.html` | Renderer HTML shell |
| `src/renderer/src/main.tsx` | React entry point |
| `src/renderer/src/App.tsx` | Root component: grid layout, state management |
| `src/renderer/src/components/TopBar.tsx` | Header with + button |
| `src/renderer/src/components/TerminalPanel.tsx` | xterm.js terminal + colored header |
| `src/renderer/src/components/ConfirmDialog.tsx` | Close confirmation modal |
| `src/renderer/src/utils/colors.ts` | Color pool and assignment |
| `src/renderer/src/utils/grid-layout.ts` | Grid position calculator |
| `src/renderer/src/types/api.d.ts` | Window.api type declarations |
| `tests/colors.test.ts` | Color utility tests |
| `tests/grid-layout.test.ts` | Grid layout calculator tests |
| `tests/store.test.ts` | Store persistence tests |

---

### Task 1: Project Scaffold & Dependencies

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Initialize package.json**

```bash
cd I:/i60-Projects/i60.CmdCLD
npm init -y
```

Then replace `package.json` contents with:

```json
{
  "name": "cmdcld",
  "version": "0.1.0",
  "description": "Multi-terminal Claude launcher",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "postinstall": "electron-rebuild",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "node-pty": "^1.0.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "react-grid-layout": "^1.5.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^2.3.0",
    "@electron/rebuild": "^3.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/react-grid-layout": "^1.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: installs all packages, `electron-rebuild` runs as postinstall and rebuilds `node-pty` for Electron. If `electron-rebuild` fails, run `npx @electron/rebuild` manually.

- [ ] **Step 3: Create build config**

Create `electron.vite.config.ts`:

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
```

- [ ] **Step 4: Create TypeScript configs**

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "target": "ESNext",
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "electron.vite.config.ts"]
}
```

Create `tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "outDir": "./out",
    "rootDir": "./src/renderer/src",
    "strict": true,
    "skipLibCheck": true,
    "target": "ESNext",
    "types": ["node"]
  },
  "include": ["src/renderer/src/**/*"]
}
```

- [ ] **Step 5: Create minimal entry points**

Create `src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

Create `src/preload/index.ts`:

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

Create `src/renderer/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CmdCLD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.tsx"></script>
</body>
</html>
```

Create `src/renderer/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

Create `src/renderer/src/App.tsx`:

```tsx
export default function App() {
  return (
    <div style={{ height: '100vh', background: '#0a0a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <h1>CmdCLD</h1>
    </div>
  )
}
```

- [ ] **Step 6: Verify the app launches**

```bash
npm run dev
```

Expected: Electron window opens showing "CmdCLD" centered on a dark background. Close the window to stop.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold electron-vite project with React + TypeScript"
```

---

### Task 2: Color Utility (TDD)

**Files:**
- Create: `src/renderer/src/utils/colors.ts`
- Test: `tests/colors.test.ts`

- [ ] **Step 1: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true
  }
})
```

- [ ] **Step 2: Write failing tests**

Create `tests/colors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assignColor, COLOR_POOL } from '../src/renderer/src/utils/colors'

describe('COLOR_POOL', () => {
  it('has at least 12 colors', () => {
    expect(COLOR_POOL.length).toBeGreaterThanOrEqual(12)
  })

  it('contains only valid hex colors', () => {
    for (const c of COLOR_POOL) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('assignColor', () => {
  it('returns a color from the pool when none are used', () => {
    const color = assignColor([])
    expect(COLOR_POOL).toContain(color)
  })

  it('does not return a color that is already used', () => {
    const used = COLOR_POOL.slice(0, 5)
    for (let i = 0; i < 20; i++) {
      const color = assignColor(used)
      expect(used).not.toContain(color)
    }
  })

  it('returns a pool color even when all are used (wraps around)', () => {
    const color = assignColor([...COLOR_POOL])
    expect(COLOR_POOL).toContain(color)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — module `../src/renderer/src/utils/colors` not found.

- [ ] **Step 4: Implement colors utility**

Create `src/renderer/src/utils/colors.ts`:

```ts
export const COLOR_POOL = [
  '#f472b6', '#38bdf8', '#fb923c', '#a78bfa',
  '#22c55e', '#f87171', '#facc15', '#2dd4bf',
  '#818cf8', '#fb7185', '#34d399', '#fbbf24',
]

export function assignColor(usedColors: string[]): string {
  const available = COLOR_POOL.filter((c) => !usedColors.includes(c))
  const pool = available.length > 0 ? available : COLOR_POOL
  return pool[Math.floor(Math.random() * pool.length)]
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/colors.ts tests/colors.test.ts vitest.config.ts
git commit -m "feat: add color pool utility with tests"
```

---

### Task 3: Grid Layout Calculator (TDD)

**Files:**
- Create: `src/renderer/src/utils/grid-layout.ts`
- Test: `tests/grid-layout.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/grid-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { calculateLayout } from '../src/renderer/src/utils/grid-layout'

describe('calculateLayout', () => {
  it('returns empty array for 0 terminals', () => {
    expect(calculateLayout(0)).toEqual([])
  })

  it('returns full-width for 1 terminal', () => {
    expect(calculateLayout(1)).toEqual([
      { i: '0', x: 0, y: 0, w: 12, h: 1 }
    ])
  })

  it('returns side-by-side for 2 terminals', () => {
    const layout = calculateLayout(2)
    expect(layout).toEqual([
      { i: '0', x: 0, y: 0, w: 6, h: 1 },
      { i: '1', x: 6, y: 0, w: 6, h: 1 }
    ])
  })

  it('returns 2x2 grid for 4 terminals', () => {
    const layout = calculateLayout(4)
    expect(layout).toEqual([
      { i: '0', x: 0, y: 0, w: 6, h: 1 },
      { i: '1', x: 6, y: 0, w: 6, h: 1 },
      { i: '2', x: 0, y: 1, w: 6, h: 1 },
      { i: '3', x: 6, y: 1, w: 6, h: 1 }
    ])
  })

  it('returns 3-column grid for 6 terminals', () => {
    const layout = calculateLayout(6)
    expect(layout[0]).toEqual({ i: '0', x: 0, y: 0, w: 4, h: 1 })
    expect(layout[3]).toEqual({ i: '3', x: 0, y: 1, w: 4, h: 1 })
    expect(layout.length).toBe(6)
  })

  it('returns 3-column grid for 8 terminals', () => {
    const layout = calculateLayout(8)
    expect(layout[0].w).toBe(4)
    expect(layout.length).toBe(8)
  })

  it('all items have positive width and height', () => {
    for (let n = 1; n <= 8; n++) {
      const layout = calculateLayout(n)
      for (const item of layout) {
        expect(item.w).toBeGreaterThan(0)
        expect(item.h).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement grid layout calculator**

Create `src/renderer/src/utils/grid-layout.ts`:

```ts
export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export function calculateLayout(count: number): LayoutItem[] {
  if (count === 0) return []

  const cols = count <= 2 ? count : count <= 4 ? 2 : 3
  const w = Math.floor(12 / cols)

  return Array.from({ length: count }, (_, idx) => ({
    i: String(idx),
    x: (idx % cols) * w,
    y: Math.floor(idx / cols),
    w,
    h: 1,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/grid-layout.ts tests/grid-layout.test.ts
git commit -m "feat: add grid layout calculator with tests"
```

---

### Task 4: Store Module (Main Process)

**Files:**
- Create: `src/main/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Store, SessionState } from '../src/main/store'

let tempDir: string
let store: Store

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cmdcld-test-'))
  store = new Store(join(tempDir, 'sessions.json'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Store', () => {
  it('returns default state when no file exists', () => {
    const state = store.load()
    expect(state.folders).toEqual([])
    expect(state.windowBounds).toBeDefined()
    expect(state.windowBounds.width).toBeGreaterThan(0)
  })

  it('saves and loads state', () => {
    const state: SessionState = {
      folders: [{ path: 'C:\\test', color: '#f472b6', layout: { x: 0, y: 0, w: 12, h: 1 } }],
      windowBounds: { width: 1400, height: 900, x: 50, y: 50 }
    }
    store.save(state)
    const loaded = new Store(join(tempDir, 'sessions.json')).load()
    expect(loaded).toEqual(state)
  })

  it('writes valid JSON to disk', () => {
    store.save({
      folders: [{ path: 'C:\\proj', color: '#22c55e', layout: { x: 0, y: 0, w: 6, h: 1 } }],
      windowBounds: { width: 1200, height: 800, x: 0, y: 0 }
    })
    const raw = readFileSync(join(tempDir, 'sessions.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.folders).toHaveLength(1)
  })

  it('handles corrupted file gracefully', () => {
    const { writeFileSync } = require('fs')
    writeFileSync(join(tempDir, 'sessions.json'), 'NOT JSON')
    const s = new Store(join(tempDir, 'sessions.json'))
    expect(s.load().folders).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — module `../src/main/store` not found.

- [ ] **Step 3: Implement store**

Create `src/main/store.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface SessionState {
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
  windowBounds: { width: number; height: number; x: number; y: number }
}

const DEFAULT_STATE: SessionState = {
  folders: [],
  windowBounds: { width: 1200, height: 800, x: 100, y: 100 }
}

export class Store {
  private state: SessionState

  constructor(private filePath: string) {
    this.state = this.loadFromDisk()
  }

  private loadFromDisk(): SessionState {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'))
      }
    } catch {
      // corrupted file — return defaults
    }
    return { ...DEFAULT_STATE, folders: [], windowBounds: { ...DEFAULT_STATE.windowBounds } }
  }

  load(): SessionState {
    return this.state
  }

  save(state: SessionState): void {
    this.state = state
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(state, null, 2))
  }

  getWindowBounds(): SessionState['windowBounds'] {
    return this.state.windowBounds
  }

  saveWindowBounds(bounds: { width: number; height: number; x: number; y: number }): void {
    this.state.windowBounds = bounds
    this.save(this.state)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts tests/store.test.ts
git commit -m "feat: add store module for session persistence"
```

---

### Task 5: PTY Manager (Main Process)

**Files:**
- Create: `src/main/pty-manager.ts`

- [ ] **Step 1: Implement PTY manager**

Create `src/main/pty-manager.ts`:

```ts
import * as pty from 'node-pty'
import { WebContents } from 'electron'

export class PtyManager {
  private ptys = new Map<string, pty.IPty>()

  create(id: string, cwd: string, webContents: WebContents): void {
    const ptyProcess = pty.spawn('powershell.exe', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send(`pty:data:${id}`, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(`pty:exit:${id}`, exitCode)
      }
      this.ptys.delete(id)
    })

    this.ptys.set(id, ptyProcess)
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.ptys.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    const p = this.ptys.get(id)
    if (p) {
      p.kill()
      this.ptys.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.ptys) {
      this.kill(id)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/pty-manager.ts
git commit -m "feat: add PTY manager for spawning terminal sessions"
```

---

### Task 6: Preload IPC Bridge & Type Declarations

**Files:**
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/types/api.d.ts`

- [ ] **Step 1: Implement preload bridge**

Replace `src/preload/index.ts` with:

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  createTerminal: (id: string, cwd: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd),

  writeTerminal: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('pty:write', id, data),

  resizeTerminal: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),

  killTerminal: (id: string): Promise<void> =>
    ipcRenderer.invoke('pty:kill', id),

  onTerminalData: (id: string, callback: (data: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: string): void => callback(data)
    ipcRenderer.on(`pty:data:${id}`, listener)
    return () => { ipcRenderer.removeListener(`pty:data:${id}`, listener) }
  },

  onTerminalExit: (id: string, callback: (exitCode: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, code: number): void => callback(code)
    ipcRenderer.on(`pty:exit:${id}`, listener)
    return () => { ipcRenderer.removeListener(`pty:exit:${id}`, listener) }
  },

  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectFolder'),

  loadState: (): Promise<unknown> =>
    ipcRenderer.invoke('store:load'),

  saveState: (state: unknown): Promise<void> =>
    ipcRenderer.invoke('store:save', state),
})
```

- [ ] **Step 2: Create renderer type declarations**

Create `src/renderer/src/types/api.d.ts`:

```ts
export interface SessionState {
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
  windowBounds: { width: number; height: number; x: number; y: number }
}

export interface ElectronAPI {
  createTerminal: (id: string, cwd: string) => Promise<void>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  onTerminalData: (id: string, callback: (data: string) => void) => () => void
  onTerminalExit: (id: string, callback: (exitCode: number) => void) => () => void
  selectFolder: () => Promise<string | null>
  loadState: () => Promise<SessionState | null>
  saveState: (state: SessionState) => Promise<void>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/renderer/src/types/api.d.ts
git commit -m "feat: add preload IPC bridge and renderer type declarations"
```

---

### Task 7: Wire Up Main Process IPC Handlers

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Update main process with IPC handlers and persistence**

Replace `src/main/index.ts` with:

```ts
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { PtyManager } from './pty-manager'
import { Store } from './store'

let mainWindow: BrowserWindow
const ptyManager = new PtyManager()
const store = new Store(join(app.getPath('userData'), 'sessions.json'))

function createWindow(): void {
  const bounds = store.getWindowBounds()
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    backgroundColor: '#0a0a1a',
    title: 'CmdCLD'
  })

  mainWindow.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const saveBounds = (): void => {
    if (!mainWindow.isDestroyed()) {
      store.saveWindowBounds(mainWindow.getBounds())
    }
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
}

// PTY IPC handlers
ipcMain.handle('pty:create', (_event, id: string, cwd: string) => {
  ptyManager.create(id, cwd, mainWindow.webContents)
})

ipcMain.handle('pty:write', (_event, id: string, data: string) => {
  ptyManager.write(id, data)
})

ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows)
})

ipcMain.handle('pty:kill', (_event, id: string) => {
  ptyManager.kill(id)
})

// Dialog IPC handler
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// Store IPC handlers
ipcMain.handle('store:load', () => {
  return store.load()
})

ipcMain.handle('store:save', (_event, state) => {
  store.save(state)
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  ptyManager.killAll()
  app.quit()
})
```

- [ ] **Step 2: Verify app still launches**

```bash
npm run dev
```

Expected: Electron window opens (still shows placeholder "CmdCLD" text). No errors in dev console. Close to stop.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire main process IPC handlers for PTY, dialog, and store"
```

---

### Task 8: Renderer UI Components

**Files:**
- Create: `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/TerminalPanel.tsx`, `src/renderer/src/components/ConfirmDialog.tsx`

- [ ] **Step 1: Create TopBar component**

Create `src/renderer/src/components/TopBar.tsx`:

```tsx
interface TopBarProps {
  count: number
  onAdd: () => void
}

export function TopBar({ count, onAdd }: TopBarProps) {
  return (
    <div style={{
      background: '#16213e',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid #0f3460',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '14px', fontFamily: 'monospace' }}>
          CmdCLD
        </span>
        <span style={{ color: '#666', fontSize: '12px' }}>
          {count} session{count !== 1 ? 's' : ''}
        </span>
      </div>
      <button
        onClick={onAdd}
        style={{
          background: '#22c55e',
          color: '#000',
          border: 'none',
          borderRadius: '6px',
          padding: '6px 16px',
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        + Add Folder
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create ConfirmDialog component**

Create `src/renderer/src/components/ConfirmDialog.tsx`:

```tsx
interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#1a1a2e',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '400px',
        width: '90%',
        border: '1px solid #333',
      }}>
        <p style={{ color: '#e0e0e0', marginBottom: '20px' }}>{message}</p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: '#333', color: '#ccc', border: 'none',
              borderRadius: '6px', padding: '8px 16px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#ef4444', color: '#fff', border: 'none',
              borderRadius: '6px', padding: '8px 16px', cursor: 'pointer',
            }}
          >
            Close Terminal
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create TerminalPanel component**

Create `src/renderer/src/components/TerminalPanel.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  onClose: () => void
}

export function TerminalPanel({ id, folderPath, folderName, color, onClose }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#0d1117' },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Small delay to ensure the container has dimensions before fitting
    requestAnimationFrame(() => {
      fitAddon.fit()

      // Create PTY and connect
      window.api.createTerminal(id, folderPath)

      const removeData = window.api.onTerminalData(id, (data) => {
        term.write(data)
      })

      const removeExit = window.api.onTerminalExit(id, (code) => {
        term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`)
      })

      term.onData((data) => {
        window.api.writeTerminal(id, data)
      })

      // Auto-launch Claude after shell is ready
      setTimeout(() => {
        window.api.writeTerminal(id, 'claude --dangerously-skip-permissions\r')
      }, 1000)

      // Store cleanup references on the terminal instance for the cleanup function
      ;(term as any)._cmdcld_cleanup = { removeData, removeExit }
    })

    // Resize observer to fit terminal when panel resizes
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
        const { cols, rows } = terminalRef.current
        window.api.resizeTerminal(id, cols, rows)
      }
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      const cleanup = (term as any)._cmdcld_cleanup
      if (cleanup) {
        cleanup.removeData()
        cleanup.removeExit()
      }
      term.dispose()
      window.api.killTerminal(id)
    }
  }, [id, folderPath])

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      border: `2px solid ${color}`,
      borderRadius: '4px',
      overflow: 'hidden',
    }}>
      <div
        className="drag-handle"
        style={{
          background: `${color}20`,
          padding: '4px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color}`,
          cursor: 'grab',
          flexShrink: 0,
        }}
      >
        <span style={{
          color,
          fontSize: '12px',
          fontFamily: 'monospace',
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {folderName}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/
git commit -m "feat: add TopBar, ConfirmDialog, and TerminalPanel components"
```

---

### Task 9: App Integration — Grid Layout & State Management

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace App.tsx with full integration**

Replace `src/renderer/src/App.tsx` with:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { TopBar } from './components/TopBar'
import { TerminalPanel } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { assignColor } from './utils/colors'
import { calculateLayout } from './utils/grid-layout'
import type { SessionState } from './types/api'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
}

export default function App() {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load saved state on mount
  useEffect(() => {
    window.api.loadState().then((state) => {
      if (state?.folders?.length) {
        const entries: TerminalEntry[] = state.folders.map((f) => ({
          id: crypto.randomUUID(),
          path: f.path,
          name: f.path.split(/[\\/]/).pop() || f.path,
          color: f.color,
        }))
        setTerminals(entries)

        const hasLayouts = state.folders.every((f) => f.layout)
        if (hasLayouts) {
          setLayouts(entries.map((e, i) => ({
            ...state.folders[i].layout,
            i: e.id,
          })))
        } else {
          setLayouts(calculateLayout(entries.length).map((pos, i) => ({
            ...pos,
            i: entries[i].id,
          })))
        }
      }
      setLoaded(true)
    })
  }, [])

  // Save state whenever terminals or layouts change
  useEffect(() => {
    if (!loaded) return
    const state: SessionState = {
      folders: terminals.map((t) => {
        const l = layouts.find((lay) => lay.i === t.id)
        return {
          path: t.path,
          color: t.color,
          layout: l
            ? { x: l.x, y: l.y, w: l.w, h: l.h }
            : { x: 0, y: 0, w: 12, h: 1 },
        }
      }),
      windowBounds: { width: 0, height: 0, x: 0, y: 0 }, // managed by main process
    }
    window.api.saveState(state)
  }, [terminals, layouts, loaded])

  const handleAddFolder = useCallback(async () => {
    const folderPath = await window.api.selectFolder()
    if (!folderPath) return

    const usedColors = terminals.map((t) => t.color)
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: folderPath,
      name: folderPath.split(/[\\/]/).pop() || folderPath,
      color: assignColor(usedColors),
    }

    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
  }, [terminals])

  const handleRequestClose = useCallback((id: string) => {
    setClosingId(id)
  }, [])

  const handleConfirmClose = useCallback(() => {
    if (!closingId) return
    const newTerminals = terminals.filter((t) => t.id !== closingId)
    setTerminals(newTerminals)

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
    setClosingId(null)
  }, [closingId, terminals])

  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setLayouts(layout)
  }, [])

  const gridRows = Math.ceil(Math.sqrt(terminals.length || 1))
  const rowHeight = Math.max(150, Math.floor((window.innerHeight - 50) / gridRows) - 12)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0a1a' }}>
      <TopBar count={terminals.length} onAdd={handleAddFolder} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {terminals.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#555',
            fontSize: '16px',
          }}>
            Click "+ Add Folder" to start a Claude session
          </div>
        ) : (
          <ResponsiveGridLayout
            layouts={{ lg: layouts }}
            breakpoints={{ lg: 0 }}
            cols={{ lg: 12 }}
            rowHeight={rowHeight}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            compactType="vertical"
            margin={[4, 4]}
          >
            {terminals.map((t) => (
              <div key={t.id}>
                <TerminalPanel
                  id={t.id}
                  folderPath={t.path}
                  folderName={t.name}
                  color={t.color}
                  onClose={() => handleRequestClose(t.id)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
      {closingId && (
        <ConfirmDialog
          message={`Close terminal for "${terminals.find((t) => t.id === closingId)?.name}"?`}
          onConfirm={handleConfirmClose}
          onCancel={() => setClosingId(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the app end-to-end**

```bash
npm run dev
```

Verify:
1. App opens with dark background and "Click + Add Folder to start a Claude session" message
2. Click "+ Add Folder" → Windows folder picker opens
3. Select a folder → terminal panel appears with colored border, showing PowerShell booting
4. After ~1 second, `claude --dangerously-skip-permissions` auto-types and runs
5. Terminal is fully interactive (can type, see output)
6. Add a second folder → grid splits into 2 panels side by side
7. Drag the header bar of a terminal → panels can be rearranged
8. Resize panels by dragging borders between them
9. Click ✕ → confirmation dialog appears → confirm → terminal closes
10. Close and reopen app → previous folders are restored

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: integrate grid layout, state management, and terminal lifecycle"
```

---

### Task 10: Final Polish & Verification

**Files:**
- Possibly minor fixes to any of the above files

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass (colors, grid-layout, store).

- [ ] **Step 2: Full manual verification**

```bash
npm run dev
```

Test the complete flow:
1. Fresh launch with no saved state → empty state message shown
2. Add 1 folder → fullscreen terminal, Claude auto-launches
3. Add 2nd folder → 2-column layout, both terminals interactive
4. Add 3rd and 4th folders → 2x2 grid
5. Add 5th folder → 3-column layout
6. Drag panels to reorder → positions update
7. Resize a panel → terminal content reflows
8. Close a terminal (✕ → confirm) → grid recalculates
9. Close app, reopen → all remaining folders restored with colors
10. Let Claude exit in one terminal → exit message shown, can still type

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete CmdCLD multi-terminal Claude launcher"
```
