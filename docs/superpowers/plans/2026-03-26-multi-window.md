# Multi-Window with Terminal Move/Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-window support with terminal move/split, collapsible sidebar navigation with focus mode, context menu with "Open in VS Code", and remove the top bar.

**Architecture:** Main process gets a window registry and enhanced PtyManager that can redirect PTY output between windows. Each renderer gets a collapsible sidebar for navigation/focus and a context menu for terminal actions. Terminals move between windows by reassigning their PTY data stream — no process restart.

**Tech Stack:** Electron (main/preload/renderer), React 18, xterm.js, react-grid-layout, node-pty, child_process (for VS Code launch)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/window-registry.ts` | Create | Track all BrowserWindows, assign labels, provide lookup |
| `src/main/pty-manager.ts` | Rewrite | Add scrollback buffer, multi-window support, move() |
| `src/main/index.ts` | Rewrite | Use window registry, add new IPC handlers, multi-window lifecycle |
| `src/main/store.ts` | Modify | Multi-window persistence format with migration |
| `src/preload/index.ts` | Modify | Add new IPC bridge methods |
| `src/renderer/src/types/api.d.ts` | Modify | Add new API type declarations |
| `src/renderer/src/components/Sidebar.tsx` | Create | Collapsible sidebar with folder list, actions |
| `src/renderer/src/components/ContextMenu.tsx` | Create | Right-click context menu |
| `src/renderer/src/components/TerminalPanel.tsx` | Modify | Add pop-out button, context menu, scrollback prop |
| `src/renderer/src/App.tsx` | Rewrite | Replace TopBar with Sidebar, add viewMode, multi-window IPC listeners |
| `src/renderer/src/components/TopBar.tsx` | Delete | Replaced by Sidebar |
| `tests/window-registry.test.ts` | Create | Unit tests for window registry |
| `tests/pty-manager.test.ts` | Create | Unit tests for scrollback buffer and move logic |
| `tests/store.test.ts` | Modify | Tests for new multi-window store format + migration |

---

### Task 1: Window Registry

**Files:**
- Create: `src/main/window-registry.ts`
- Create: `tests/window-registry.test.ts`

- [ ] **Step 1: Write failing tests for WindowRegistry**

```ts
// tests/window-registry.test.ts
import { describe, it, expect, vi } from 'vitest'

// We test the pure logic, mocking BrowserWindow
interface FakeWindow {
  id: number
  webContents: { id: number; isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
  isDestroyed: () => boolean
  getBounds: () => { x: number; y: number; width: number; height: number }
}

function makeFakeWindow(id: number): FakeWindow {
  return {
    id,
    webContents: { id, isDestroyed: () => false, send: vi.fn() },
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  }
}

// Import after mocks are set up — the actual class is pure enough to test directly
// We'll import from the source once it exists
describe('WindowRegistry', () => {
  it('registers a window and assigns label "Window 1"', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    const fw = makeFakeWindow(1)
    reg.register('win-1', fw as any)
    const list = reg.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({ id: 'win-1', label: 'Window 1' })
  })

  it('assigns sequential labels', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    reg.register('a', makeFakeWindow(1) as any)
    reg.register('b', makeFakeWindow(2) as any)
    const list = reg.list()
    expect(list.map((w) => w.label)).toEqual(['Window 1', 'Window 2'])
  })

  it('reuses labels after unregister', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    reg.register('a', makeFakeWindow(1) as any)
    reg.register('b', makeFakeWindow(2) as any)
    reg.unregister('a')
    reg.register('c', makeFakeWindow(3) as any)
    const labels = reg.list().map((w) => w.label)
    expect(labels).toContain('Window 1')
    expect(labels).toContain('Window 2')
  })

  it('getWebContents returns correct webContents', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    const fw = makeFakeWindow(42)
    reg.register('x', fw as any)
    expect(reg.getWebContents('x')).toBe(fw.webContents)
  })

  it('getWebContents returns undefined for unknown id', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    expect(reg.getWebContents('nope')).toBeUndefined()
  })

  it('listExcluding filters out the given id', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    reg.register('a', makeFakeWindow(1) as any)
    reg.register('b', makeFakeWindow(2) as any)
    const list = reg.listExcluding('a')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('b')
  })

  it('broadcastExcept sends to all windows except the excluded one', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    const fw1 = makeFakeWindow(1)
    const fw2 = makeFakeWindow(2)
    reg.register('a', fw1 as any)
    reg.register('b', fw2 as any)
    reg.broadcastExcept('a', 'test-channel', { data: 1 })
    expect(fw1.webContents.send).not.toHaveBeenCalled()
    expect(fw2.webContents.send).toHaveBeenCalledWith('test-channel', { data: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/window-registry.test.ts`
Expected: FAIL — cannot import `../src/main/window-registry`

- [ ] **Step 3: Implement WindowRegistry**

```ts
// src/main/window-registry.ts
import { BrowserWindow } from 'electron'

export interface WindowInfo {
  id: string
  label: string
}

interface RegistryEntry {
  window: BrowserWindow
  label: string
}

export class WindowRegistry {
  private windows = new Map<string, RegistryEntry>()

  register(id: string, window: BrowserWindow): string {
    const label = this.nextLabel()
    this.windows.set(id, { window, label })
    return label
  }

  unregister(id: string): void {
    this.windows.delete(id)
  }

  get(id: string): BrowserWindow | undefined {
    return this.windows.get(id)?.window
  }

  getWebContents(id: string): Electron.WebContents | undefined {
    const entry = this.windows.get(id)
    return entry?.window.isDestroyed() ? undefined : entry?.window.webContents
  }

  list(): WindowInfo[] {
    return Array.from(this.windows.entries()).map(([id, e]) => ({
      id,
      label: e.label,
    }))
  }

  listExcluding(excludeId: string): WindowInfo[] {
    return this.list().filter((w) => w.id !== excludeId)
  }

  broadcastExcept(excludeId: string, channel: string, ...args: unknown[]): void {
    for (const [id, entry] of this.windows) {
      if (id !== excludeId && !entry.window.isDestroyed()) {
        entry.window.webContents.send(channel, ...args)
      }
    }
  }

  broadcastAll(channel: string, ...args: unknown[]): void {
    for (const [, entry] of this.windows) {
      if (!entry.window.isDestroyed()) {
        entry.window.webContents.send(channel, ...args)
      }
    }
  }

  size(): number {
    return this.windows.size
  }

  private nextLabel(): string {
    const usedNumbers = new Set(
      Array.from(this.windows.values()).map((e) => {
        const match = e.label.match(/Window (\d+)/)
        return match ? parseInt(match[1], 10) : 0
      })
    )
    let n = 1
    while (usedNumbers.has(n)) n++
    return `Window ${n}`
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/window-registry.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/window-registry.ts tests/window-registry.test.ts
git commit -m "feat: add WindowRegistry for multi-window management"
```

---

### Task 2: PtyManager Multi-Window + Scrollback

**Files:**
- Rewrite: `src/main/pty-manager.ts`
- Create: `tests/pty-manager.test.ts`

- [ ] **Step 1: Write failing tests for scrollback buffer and move logic**

```ts
// tests/pty-manager.test.ts
import { describe, it, expect } from 'vitest'
import { ScrollbackBuffer } from '../src/main/pty-manager'

describe('ScrollbackBuffer', () => {
  it('stores and retrieves data', () => {
    const buf = new ScrollbackBuffer(10)
    buf.push('hello\n')
    buf.push('world\n')
    expect(buf.getAll()).toBe('hello\nworld\n')
  })

  it('respects max size by dropping old data', () => {
    const buf = new ScrollbackBuffer(20)
    buf.push('a'.repeat(15))
    buf.push('b'.repeat(10))
    const result = buf.getAll()
    // Total would be 25, so oldest data is dropped to fit within 20
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result).toContain('b'.repeat(10))
  })

  it('handles empty buffer', () => {
    const buf = new ScrollbackBuffer(100)
    expect(buf.getAll()).toBe('')
  })

  it('clears buffer', () => {
    const buf = new ScrollbackBuffer(100)
    buf.push('data')
    buf.clear()
    expect(buf.getAll()).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pty-manager.test.ts`
Expected: FAIL — cannot import `ScrollbackBuffer`

- [ ] **Step 3: Rewrite PtyManager with scrollback and multi-window support**

```ts
// src/main/pty-manager.ts
import * as pty from 'node-pty'
import { WebContents } from 'electron'

export class ScrollbackBuffer {
  private chunks: string[] = []
  private totalLength = 0

  constructor(private maxSize: number) {}

  push(data: string): void {
    this.chunks.push(data)
    this.totalLength += data.length
    while (this.totalLength > this.maxSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!
      this.totalLength -= removed.length
    }
  }

  getAll(): string {
    return this.chunks.join('')
  }

  clear(): void {
    this.chunks = []
    this.totalLength = 0
  }
}

export interface TerminalMeta {
  id: string
  path: string
  name: string
  color: string
}

interface PtyEntry {
  process: pty.IPty
  webContents: WebContents
  scrollback: ScrollbackBuffer
  meta: TerminalMeta
  dataDisposable: { dispose: () => void } | null
  exitDisposable: { dispose: () => void } | null
}

const SCROLLBACK_SIZE = 200_000 // ~200KB of terminal output

export class PtyManager {
  private ptys = new Map<string, PtyEntry>()

  create(id: string, cwd: string, webContents: WebContents, meta: TerminalMeta): void {
    const ptyProcess = pty.spawn('powershell.exe', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    })

    const scrollback = new ScrollbackBuffer(SCROLLBACK_SIZE)
    const entry: PtyEntry = {
      process: ptyProcess,
      webContents,
      scrollback,
      meta,
      dataDisposable: null,
      exitDisposable: null,
    }

    entry.dataDisposable = ptyProcess.onData((data) => {
      scrollback.push(data)
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send(`pty:data:${id}`, data)
      }
    })

    entry.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send(`pty:exit:${id}`, exitCode)
      }
      this.ptys.delete(id)
    })

    this.ptys.set(id, entry)
  }

  move(id: string, newWebContents: WebContents): string | null {
    const entry = this.ptys.get(id)
    if (!entry) return null

    const scrollbackData = entry.scrollback.getAll()
    entry.webContents = newWebContents

    return scrollbackData
  }

  getMeta(id: string): TerminalMeta | undefined {
    return this.ptys.get(id)?.meta
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.ptys.get(id)?.process.resize(cols, rows)
  }

  kill(id: string): void {
    const entry = this.ptys.get(id)
    if (entry) {
      entry.process.kill()
      this.ptys.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.ptys) {
      this.kill(id)
    }
  }

  listByWebContents(webContents: WebContents): TerminalMeta[] {
    const result: TerminalMeta[] = []
    for (const entry of this.ptys.values()) {
      if (entry.webContents === webContents) {
        result.push(entry.meta)
      }
    }
    return result
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pty-manager.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/pty-manager.ts tests/pty-manager.test.ts
git commit -m "feat: add scrollback buffer and multi-window support to PtyManager"
```

---

### Task 3: Store Multi-Window Format + Migration

**Files:**
- Modify: `src/main/store.ts`
- Modify: `tests/store.test.ts`

- [ ] **Step 1: Write failing test for new store format**

Add to `tests/store.test.ts`:

```ts
// Add these tests to the existing file
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Store } from '../src/main/store'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(__dirname, '.tmp-store-test')
const TEST_FILE = join(TEST_DIR, 'sessions.json')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('Store multi-window', () => {
  it('loads new multi-window format', () => {
    const data = {
      windows: [{
        id: 'win-1',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
        sidebarCollapsed: false,
        viewMode: 'grid',
        folders: [{ path: 'C:\\project', color: '#f00', layout: { x: 0, y: 0, w: 12, h: 1 } }],
      }],
    }
    writeFileSync(TEST_FILE, JSON.stringify(data))
    const store = new Store(TEST_FILE)
    const state = store.load()
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0].folders[0].path).toBe('C:\\project')
  })

  it('migrates old single-window format', () => {
    const oldData = {
      folders: [
        { path: 'C:\\old-project', color: '#0f0', layout: { x: 0, y: 0, w: 12, h: 1 } },
      ],
      windowBounds: { x: 100, y: 100, width: 1000, height: 700 },
    }
    writeFileSync(TEST_FILE, JSON.stringify(oldData))
    const store = new Store(TEST_FILE)
    const state = store.load()
    expect(state.windows).toHaveLength(1)
    expect(state.windows[0].folders[0].path).toBe('C:\\old-project')
    expect(state.windows[0].bounds.width).toBe(1000)
  })

  it('returns default state for empty/missing file', () => {
    const store = new Store(TEST_FILE)
    const state = store.load()
    expect(state.windows).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `state.windows` does not exist in old format

- [ ] **Step 3: Update Store for multi-window format**

```ts
// src/main/store.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface WindowState {
  id: string
  bounds: { width: number; height: number; x: number; y: number }
  sidebarCollapsed: boolean
  viewMode: 'grid' | { focused: string }
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
}

export interface MultiWindowState {
  windows: WindowState[]
}

// Old format for migration
interface LegacyState {
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
  windowBounds: { width: number; height: number; x: number; y: number }
}

const DEFAULT_STATE: MultiWindowState = { windows: [] }

export class Store {
  private state: MultiWindowState

  constructor(private filePath: string) {
    this.state = this.loadFromDisk()
  }

  private loadFromDisk(): MultiWindowState {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        // New format has `windows` array
        if (raw.windows && Array.isArray(raw.windows)) {
          return raw as MultiWindowState
        }
        // Old format has `folders` array at top level — migrate
        if (raw.folders && Array.isArray(raw.folders)) {
          return this.migrate(raw as LegacyState)
        }
      }
    } catch {
      // corrupted file
    }
    return { windows: [] }
  }

  private migrate(legacy: LegacyState): MultiWindowState {
    return {
      windows: [{
        id: 'migrated',
        bounds: legacy.windowBounds || { width: 1200, height: 800, x: 100, y: 100 },
        sidebarCollapsed: false,
        viewMode: 'grid',
        folders: legacy.folders || [],
      }],
    }
  }

  load(): MultiWindowState {
    return this.state
  }

  save(state: MultiWindowState): void {
    this.state = state
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(state, null, 2))
  }

  getWindowBounds(windowId?: string): { width: number; height: number; x: number; y: number } {
    const win = this.state.windows.find((w) => w.id === windowId)
    return win?.bounds || { width: 1200, height: 800, x: 100, y: 100 }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/store.test.ts`
Expected: All tests PASS (both old and new)

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts tests/store.test.ts
git commit -m "feat: multi-window store format with legacy migration"
```

---

### Task 4: Preload + Type Declarations

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/api.d.ts`

- [ ] **Step 1: Update preload with new IPC methods**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Existing PTY methods
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

  // Existing dialog/store
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectFolder'),

  loadState: (): Promise<unknown> =>
    ipcRenderer.invoke('store:load'),

  saveState: (state: unknown): Promise<void> =>
    ipcRenderer.invoke('store:save', state),

  // New: window management
  windowCreate: (): Promise<string> =>
    ipcRenderer.invoke('window:create'),

  windowList: (): Promise<Array<{ id: string; label: string }>> =>
    ipcRenderer.invoke('window:list'),

  // New: terminal move
  moveTerminal: (terminalId: string, targetWindowId: string): Promise<void> =>
    ipcRenderer.invoke('terminal:move', terminalId, targetWindowId),

  // New: VS Code
  openInVscode: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('vscode:open', folderPath),

  // New: receive events for multi-window
  onTerminalReceive: (callback: (data: {
    id: string; path: string; name: string; color: string; scrollback: string
  }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any): void => callback(data)
    ipcRenderer.on('terminal:receive', listener)
    return () => { ipcRenderer.removeListener('terminal:receive', listener) }
  },

  onTerminalRemoved: (callback: (terminalId: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('terminal:removed', listener)
    return () => { ipcRenderer.removeListener('terminal:removed', listener) }
  },

  onWindowListUpdated: (callback: (windows: Array<{ id: string; label: string }>) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, windows: any): void => callback(windows)
    ipcRenderer.on('window:list-updated', listener)
    return () => { ipcRenderer.removeListener('window:list-updated', listener) }
  },
})
```

- [ ] **Step 2: Update type declarations**

```ts
// src/renderer/src/types/api.d.ts
export interface WindowInfo {
  id: string
  label: string
}

export interface TerminalTransfer {
  id: string
  path: string
  name: string
  color: string
  scrollback: string
}

export interface WindowState {
  id: string
  bounds: { width: number; height: number; x: number; y: number }
  sidebarCollapsed: boolean
  viewMode: 'grid' | { focused: string }
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
}

export interface MultiWindowState {
  windows: WindowState[]
}

export interface ElectronAPI {
  createTerminal: (id: string, cwd: string) => Promise<void>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  onTerminalData: (id: string, callback: (data: string) => void) => () => void
  onTerminalExit: (id: string, callback: (exitCode: number) => void) => () => void
  selectFolder: () => Promise<string | null>
  loadState: () => Promise<MultiWindowState | null>
  saveState: (state: MultiWindowState) => Promise<void>
  windowCreate: () => Promise<string>
  windowList: () => Promise<WindowInfo[]>
  moveTerminal: (terminalId: string, targetWindowId: string) => Promise<void>
  openInVscode: (folderPath: string) => Promise<void>
  onTerminalReceive: (callback: (data: TerminalTransfer) => void) => () => void
  onTerminalRemoved: (callback: (terminalId: string) => void) => () => void
  onWindowListUpdated: (callback: (windows: WindowInfo[]) => void) => () => void
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
git commit -m "feat: add preload IPC bridge and types for multi-window"
```

---

### Task 5: Main Process — Multi-Window IPC + Lifecycle

**Files:**
- Rewrite: `src/main/index.ts`

- [ ] **Step 1: Rewrite main process**

```ts
// src/main/index.ts
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { PtyManager } from './pty-manager'
import { Store } from './store'
import { WindowRegistry } from './window-registry'
import type { TerminalMeta } from './pty-manager'

const ptyManager = new PtyManager()
const store = new Store(join(app.getPath('userData'), 'sessions.json'))
const registry = new WindowRegistry()

function createWindow(windowId?: string): { id: string; window: BrowserWindow } {
  const id = windowId || crypto.randomUUID()
  const bounds = store.getWindowBounds(id)

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    backgroundColor: '#0a0a1a',
    title: 'CmdCLD',
  })

  win.maximize()
  win.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registry.register(id, win)

  // Broadcast updated window list to all renderers
  broadcastWindowList()

  // Save bounds on resize/move
  const saveBounds = (): void => {
    if (!win.isDestroyed()) {
      // Bounds are saved as part of the full state save from renderer
    }
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  win.on('closed', () => {
    // Kill all PTYs owned by this window
    const owned = ptyManager.listByWebContents(win.webContents)
    for (const meta of owned) {
      ptyManager.kill(meta.id)
    }
    registry.unregister(id)
    broadcastWindowList()

    if (registry.size() === 0) {
      app.quit()
    }
  })

  return { id, window: win }
}

function broadcastWindowList(): void {
  const list = registry.list()
  registry.broadcastAll('window:list-updated', list)
}

// Identify which window sent the IPC event
function getWindowIdFromEvent(event: Electron.IpcMainInvokeEvent): string | undefined {
  const list = registry.list()
  for (const info of list) {
    const wc = registry.getWebContents(info.id)
    if (wc && wc.id === event.sender.id) return info.id
  }
  return undefined
}

// PTY IPC handlers
ipcMain.handle('pty:create', (event, id: string, cwd: string) => {
  const windowId = getWindowIdFromEvent(event)
  if (!windowId) return
  const wc = registry.getWebContents(windowId)
  if (!wc) return
  const name = cwd.split(/[\\/]/).pop() || cwd
  const meta: TerminalMeta = { id, path: cwd, name, color: '' }
  ptyManager.create(id, cwd, wc, meta)
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

// Window management
ipcMain.handle('window:create', () => {
  const { id } = createWindow()
  return id
})

ipcMain.handle('window:list', (event) => {
  const callerId = getWindowIdFromEvent(event)
  if (!callerId) return []
  return registry.listExcluding(callerId)
})

// Terminal move
ipcMain.handle('terminal:move', (event, terminalId: string, targetWindowId: string) => {
  let targetId = targetWindowId
  if (targetId === 'new') {
    const { id } = createWindow()
    targetId = id
  }

  const targetWc = registry.getWebContents(targetId)
  if (!targetWc) return

  const meta = ptyManager.getMeta(terminalId)
  if (!meta) return

  const scrollback = ptyManager.move(terminalId, targetWc)

  // Tell target window to add the terminal
  targetWc.send('terminal:receive', {
    id: meta.id,
    path: meta.path,
    name: meta.name,
    color: meta.color,
    scrollback: scrollback || '',
  })

  // Tell source window to remove the terminal
  const sourceId = getWindowIdFromEvent(event)
  if (sourceId) {
    const sourceWc = registry.getWebContents(sourceId)
    if (sourceWc) {
      sourceWc.send('terminal:removed', terminalId)
    }
  }
})

// VS Code
ipcMain.handle('vscode:open', (_event, folderPath: string) => {
  exec(`code "${folderPath}"`)
})

// Dialog IPC handler
ipcMain.handle('dialog:selectFolder', async (event) => {
  const windowId = getWindowIdFromEvent(event)
  const win = windowId ? registry.get(windowId) : undefined
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
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

app.whenReady().then(() => createWindow())

app.on('window-all-closed', () => {
  ptyManager.killAll()
  app.quit()
})
```

- [ ] **Step 2: Verify the app still starts**

Run: `npm run dev`
Expected: App launches, terminals can still be created. (No sidebar yet — TopBar still imported in App.tsx, which will be replaced in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: multi-window main process with window registry and terminal move IPC"
```

---

### Task 6: Sidebar Component

**Files:**
- Create: `src/renderer/src/components/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar component**

```tsx
// src/renderer/src/components/Sidebar.tsx
import { useState } from 'react'

interface TerminalEntry {
  id: string
  name: string
  color: string
}

type ViewMode = { type: 'grid' } | { type: 'focused'; terminalId: string }

interface SidebarProps {
  terminals: TerminalEntry[]
  viewMode: ViewMode
  onSelectTerminal: (id: string) => void
  onShowAll: () => void
  onAddFolder: () => void
  onNewWindow: () => void
}

const EXPANDED_WIDTH = 180
const COLLAPSED_WIDTH = 36

export function Sidebar({
  terminals,
  viewMode,
  onSelectTerminal,
  onShowAll,
  onAddFolder,
  onNewWindow,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
  }

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH

  const btnStyle = (active = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: collapsed ? '6px 0' : '6px 10px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'rgba(255,255,255,0.08)' : 'none',
    border: 'none',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '3px',
    textAlign: 'left',
  })

  return (
    <div style={{
      width,
      minWidth: width,
      height: '100%',
      background: '#0d1117',
      borderRight: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 150ms ease',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Action buttons */}
      <div style={{ padding: '6px 4px', borderBottom: '1px solid #1e293b' }}>
        <button onClick={onAddFolder} style={btnStyle()} title="Add Folder">
          <span style={{ color: '#22c55e', fontSize: '14px', lineHeight: 1 }}>+</span>
          {!collapsed && <span>Add Folder</span>}
        </button>
        <button onClick={onNewWindow} style={btnStyle()} title="New Window">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#8862;</span>
          {!collapsed && <span>New Window</span>}
        </button>
      </div>

      {/* Folder list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
        {terminals.map((t) => {
          const isActive = viewMode.type === 'focused' && viewMode.terminalId === t.id
          return (
            <button
              key={t.id}
              onClick={() => onSelectTerminal(t.id)}
              style={btnStyle(isActive)}
              title={t.name}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: t.color,
                flexShrink: 0,
              }} />
              {!collapsed && (
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {t.name}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ padding: '6px 4px', borderTop: '1px solid #1e293b' }}>
        <button onClick={onShowAll} style={btnStyle(viewMode.type === 'grid')} title="Show All">
          <span style={{ fontSize: '13px', lineHeight: 1 }}>&#9635;</span>
          {!collapsed && <span>Show All</span>}
        </button>
        <button onClick={toggleCollapsed} style={btnStyle()} title={collapsed ? 'Expand' : 'Collapse'}>
          <span style={{ fontSize: '12px', lineHeight: 1 }}>{collapsed ? '\u25B6' : '\u25C0'}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx
git commit -m "feat: add collapsible Sidebar component"
```

---

### Task 7: ContextMenu Component

**Files:**
- Create: `src/renderer/src/components/ContextMenu.tsx`

- [ ] **Step 1: Create ContextMenu component**

```tsx
// src/renderer/src/components/ContextMenu.tsx
import { useEffect, useRef } from 'react'
import type { WindowInfo } from '../types/api'

export interface ContextMenuItem {
  label: string
  onClick?: () => void
  submenu?: ContextMenuItem[]
  separator?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') { onClose(); return }
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [onClose])

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    background: '#1a1a2e',
    border: '1px solid #333',
    borderRadius: '6px',
    padding: '4px 0',
    minWidth: '160px',
    zIndex: 2000,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  }

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    background: 'none',
    border: 'none',
    color: '#ccc',
    fontSize: '12px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    textAlign: 'left',
  }

  return (
    <div ref={ref} style={menuStyle}>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: '1px', background: '#333', margin: '4px 0' }} />
        }
        if (item.submenu) {
          return <SubmenuItem key={i} item={item} itemStyle={itemStyle} />
        }
        return (
          <button
            key={i}
            style={itemStyle}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
            onClick={() => { item.onClick?.(); }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function SubmenuItem({ item, itemStyle }: { item: ContextMenuItem; itemStyle: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        style={{ ...itemStyle, display: 'flex', justifyContent: 'space-between' }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
      >
        <span>{item.label}</span>
        <span style={{ marginLeft: '8px' }}>{'\u25B6'}</span>
      </button>
      {open && item.submenu && (
        <div style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          background: '#1a1a2e',
          border: '1px solid #333',
          borderRadius: '6px',
          padding: '4px 0',
          minWidth: '140px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {item.submenu.map((sub, i) => (
            <button
              key={i}
              style={itemStyle}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none' }}
              onClick={() => sub.onClick?.()}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Helper to build context menu items for a terminal
export function buildTerminalMenuItems(
  terminalId: string,
  folderPath: string,
  otherWindows: WindowInfo[],
  onMove: (terminalId: string, targetWindowId: string) => void,
  onOpenVscode: (path: string) => void,
): ContextMenuItem[] {
  const moveSubmenu: ContextMenuItem[] = [
    { label: 'New Window', onClick: () => onMove(terminalId, 'new') },
    ...otherWindows.map((w) => ({
      label: w.label,
      onClick: () => onMove(terminalId, w.id),
    })),
  ]

  return [
    { label: 'Move to', submenu: moveSubmenu },
    { separator: true },
    { label: 'Open in VS Code', onClick: () => onOpenVscode(folderPath) },
  ]
}
```

Note: Add missing `import { useState } from 'react'` to the existing import at the top — the `SubmenuItem` uses `useState`. The full import line should be:

```ts
import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/ContextMenu.tsx
git commit -m "feat: add ContextMenu component with submenu support"
```

---

### Task 8: Update TerminalPanel — Pop-Out Button + Context Menu + Scrollback

**Files:**
- Modify: `src/renderer/src/components/TerminalPanel.tsx`

- [ ] **Step 1: Update TerminalPanel**

Replace the full file content:

```tsx
// src/renderer/src/components/TerminalPanel.tsx
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ContextMenu, buildTerminalMenuItems } from './ContextMenu'
import type { WindowInfo } from '../types/api'

interface TerminalPanelProps {
  id: string
  folderPath: string
  folderName: string
  color: string
  onClose: () => void
  windowList: WindowInfo[]
  onMove: (terminalId: string, targetWindowId: string) => void
  initialScrollback?: string
  skipAutoLaunch?: boolean
}

export function TerminalPanel({
  id,
  folderPath,
  folderName,
  color,
  onClose,
  windowList,
  onMove,
  initialScrollback,
  skipAutoLaunch,
}: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [popoutOpen, setPopoutOpen] = useState(false)
  const popoutRef = useRef<HTMLDivElement>(null)

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

    requestAnimationFrame(() => {
      fitAddon.fit()

      // Write scrollback if this terminal was moved from another window
      if (initialScrollback) {
        term.write(initialScrollback)
      }

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

      // Enable Ctrl+V paste from clipboard
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
          navigator.clipboard.readText().then((text) => {
            if (text) window.api.writeTerminal(id, text)
          })
          return false
        }
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection())
          return false
        }
        return true
      })

      // Auto-launch Claude after shell is ready
      if (!skipAutoLaunch) {
        setTimeout(() => {
          window.api.writeTerminal(id, 'claude --dangerously-skip-permissions\r')
        }, 1000)
      }

      ;(term as any)._cmdcld_cleanup = { removeData, removeExit }
    })

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

  // Close popout dropdown on outside click
  useEffect(() => {
    if (!popoutOpen) return
    const handler = (e: MouseEvent) => {
      if (popoutRef.current && !popoutRef.current.contains(e.target as Node)) {
        setPopoutOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoutOpen])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handlePopout = () => {
    if (windowList.length === 0) {
      onMove(id, 'new')
    } else {
      setPopoutOpen(!popoutOpen)
    }
  }

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
        onContextMenu={handleContextMenu}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
          {/* Pop-out button */}
          <button
            onClick={handlePopout}
            onMouseDown={(e) => e.stopPropagation()}
            title="Move to another window"
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &#10697;
          </button>
          {/* Pop-out dropdown */}
          {popoutOpen && (
            <div ref={popoutRef} style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: '#1a1a2e',
              border: '1px solid #333',
              borderRadius: '6px',
              padding: '4px 0',
              minWidth: '120px',
              zIndex: 2000,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <button
                onClick={() => { onMove(id, 'new'); setPopoutOpen(false) }}
                style={{
                  display: 'block', width: '100%', padding: '6px 12px',
                  background: 'none', border: 'none', color: '#ccc',
                  fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left',
                }}
              >
                New Window
              </button>
              {windowList.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { onMove(id, w.id); setPopoutOpen(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '6px 12px',
                    background: 'none', border: 'none', color: '#ccc',
                    fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
          {/* Close button */}
          <button
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
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
            &#10005;
          </button>
        </div>
      </div>
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildTerminalMenuItems(
            id,
            folderPath,
            windowList,
            (tid, wid) => { onMove(tid, wid); setContextMenu(null) },
            (path) => { window.api.openInVscode(path); setContextMenu(null) },
          )}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build` (or just check that dev server compiles without errors)
Expected: No TypeScript or build errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/TerminalPanel.tsx
git commit -m "feat: add pop-out button, context menu, and scrollback to TerminalPanel"
```

---

### Task 9: Rewrite App.tsx — Sidebar, ViewMode, Multi-Window Events

**Files:**
- Rewrite: `src/renderer/src/App.tsx`
- Delete: `src/renderer/src/components/TopBar.tsx`

- [ ] **Step 1: Rewrite App.tsx**

```tsx
// src/renderer/src/App.tsx
import { useState, useEffect, useCallback } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Sidebar } from './components/Sidebar'
import { TerminalPanel } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { assignColor } from './utils/colors'
import { calculateLayout } from './utils/grid-layout'
import type { MultiWindowState, WindowInfo, TerminalTransfer } from './types/api'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
  initialScrollback?: string
  skipAutoLaunch?: boolean
}

type ViewMode = { type: 'grid' } | { type: 'focused'; terminalId: string }

export default function App() {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>({ type: 'grid' })
  const [windowList, setWindowList] = useState<WindowInfo[]>([])

  // Load saved state on mount
  useEffect(() => {
    window.api.loadState().then((state) => {
      if (state?.windows?.length) {
        // For now, load the first window's state (multi-window restore is handled by main process)
        const win = state.windows[0]
        if (win?.folders?.length) {
          const entries: TerminalEntry[] = win.folders.map((f) => ({
            id: crypto.randomUUID(),
            path: f.path,
            name: f.path.split(/[\\/]/).pop() || f.path,
            color: f.color,
          }))
          setTerminals(entries)

          const hasLayouts = win.folders.every((f) => f.layout)
          if (hasLayouts) {
            setLayouts(entries.map((e, i) => ({
              ...win.folders[i].layout,
              i: e.id,
            })))
          } else {
            setLayouts(calculateLayout(entries.length).map((pos, i) => ({
              ...pos,
              i: entries[i].id,
            })))
          }
        }
      }
      setLoaded(true)
    })

    // Fetch initial window list
    window.api.windowList().then(setWindowList)
  }, [])

  // Listen for multi-window events
  useEffect(() => {
    const removeReceive = window.api.onTerminalReceive((data: TerminalTransfer) => {
      const newEntry: TerminalEntry = {
        id: data.id,
        path: data.path,
        name: data.name,
        color: data.color,
        initialScrollback: data.scrollback,
        skipAutoLaunch: true,
      }
      setTerminals((prev) => {
        const next = [...prev, newEntry]
        setLayouts(calculateLayout(next.length).map((pos, i) => ({
          ...pos,
          i: next[i].id,
        })))
        return next
      })
    })

    const removeRemoved = window.api.onTerminalRemoved((terminalId: string) => {
      setTerminals((prev) => {
        const next = prev.filter((t) => t.id !== terminalId)
        setLayouts(calculateLayout(next.length).map((pos, i) => ({
          ...pos,
          i: next[i].id,
        })))
        return next
      })
      setViewMode((prev) =>
        prev.type === 'focused' && prev.terminalId === terminalId
          ? { type: 'grid' }
          : prev
      )
    })

    const removeWindowList = window.api.onWindowListUpdated((windows: WindowInfo[]) => {
      setWindowList(windows)
    })

    return () => {
      removeReceive()
      removeRemoved()
      removeWindowList()
    }
  }, [])

  // Save state whenever terminals or layouts change
  useEffect(() => {
    if (!loaded) return
    const state: MultiWindowState = {
      windows: [{
        id: 'current',
        bounds: { width: 0, height: 0, x: 0, y: 0 },
        sidebarCollapsed: false,
        viewMode: viewMode.type === 'grid' ? 'grid' : { focused: viewMode.terminalId },
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
      }],
    }
    window.api.saveState(state)
  }, [terminals, layouts, loaded, viewMode])

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
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === closingId
        ? { type: 'grid' }
        : prev
    )
  }, [closingId, terminals])

  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setLayouts(layout)
  }, [])

  const handleMove = useCallback((terminalId: string, targetWindowId: string) => {
    window.api.moveTerminal(terminalId, targetWindowId)
  }, [])

  const handleNewWindow = useCallback(() => {
    window.api.windowCreate()
  }, [])

  const handleSelectTerminal = useCallback((id: string) => {
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === id
        ? { type: 'grid' }
        : { type: 'focused', terminalId: id }
    )
  }, [])

  const handleShowAll = useCallback(() => {
    setViewMode({ type: 'grid' })
  }, [])

  const gridRows = Math.ceil(Math.sqrt(terminals.length || 1))
  const rowHeight = Math.max(150, Math.floor(window.innerHeight / gridRows) - 4)

  const focusedTerminal = viewMode.type === 'focused'
    ? terminals.find((t) => t.id === viewMode.terminalId)
    : null

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#0a0a1a' }}>
      <Sidebar
        terminals={terminals}
        viewMode={viewMode}
        onSelectTerminal={handleSelectTerminal}
        onShowAll={handleShowAll}
        onAddFolder={handleAddFolder}
        onNewWindow={handleNewWindow}
      />
      <div style={{ flex: 1, overflow: 'hidden' }}>
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
        ) : focusedTerminal ? (
          /* Focused mode: single terminal fills the space */
          <div style={{ height: '100%' }}>
            <TerminalPanel
              key={focusedTerminal.id}
              id={focusedTerminal.id}
              folderPath={focusedTerminal.path}
              folderName={focusedTerminal.name}
              color={focusedTerminal.color}
              onClose={() => handleRequestClose(focusedTerminal.id)}
              windowList={windowList}
              onMove={handleMove}
              initialScrollback={focusedTerminal.initialScrollback}
              skipAutoLaunch={focusedTerminal.skipAutoLaunch}
            />
          </div>
        ) : (
          /* Grid mode */
          <ResponsiveGridLayout
            layouts={{ lg: layouts }}
            breakpoints={{ lg: 0 }}
            cols={{ lg: 12 }}
            rowHeight={rowHeight}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            compactType="vertical"
            margin={[2, 2]}
          >
            {terminals.map((t) => (
              <div key={t.id}>
                <TerminalPanel
                  id={t.id}
                  folderPath={t.path}
                  folderName={t.name}
                  color={t.color}
                  onClose={() => handleRequestClose(t.id)}
                  windowList={windowList}
                  onMove={handleMove}
                  initialScrollback={t.initialScrollback}
                  skipAutoLaunch={t.skipAutoLaunch}
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

- [ ] **Step 2: Delete TopBar.tsx**

```bash
rm src/renderer/src/components/TopBar.tsx
```

- [ ] **Step 3: Verify the app builds and runs**

Run: `npm run dev`
Expected: App launches with sidebar on the left, no top bar. Can add folders. Can click a folder name in sidebar to focus it. Can click "Show All" to return to grid.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git rm src/renderer/src/components/TopBar.tsx
git commit -m "feat: replace TopBar with Sidebar, add viewMode focus/grid, multi-window events"
```

---

### Task 10: Integration Testing + Polish

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass. If any old tests fail due to store format changes, fix them.

- [ ] **Step 2: Manual integration test checklist**

Run `npm run dev` and verify:

1. App starts maximized with sidebar on the left
2. Sidebar shows "Add Folder" and "New Window" buttons
3. Click "Add Folder" — folder picker opens, terminal appears in grid
4. Add a second folder — grid shows 2 terminals
5. Click a folder name in sidebar — that terminal fills the main area
6. Click "Show All" — grid layout returns
7. Collapse sidebar — shows thin icon strip with colored dots
8. Click a colored dot in collapsed sidebar — focuses that terminal
9. Expand sidebar — full labels visible again
10. Right-click terminal drag handle — context menu appears with "Move to" and "Open in VS Code"
11. Click "Open in VS Code" — VS Code opens to that folder
12. Click "New Window" — second window opens
13. Click pop-out button (⧉) on a terminal — dropdown shows "New Window" + other windows
14. Move a terminal to the other window — terminal appears there with scrollback
15. Ctrl+V paste works in terminals
16. Scrollbars are thin and styled

- [ ] **Step 3: Fix any issues found during manual testing**

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for multi-window"
```

---

### Task 11: Final Cleanup

- [ ] **Step 1: Remove any unused imports or dead code**

Check each modified file for unused imports (especially the old `TopBar` import or old `SessionState` type references).

- [ ] **Step 2: Run build to confirm production build works**

Run: `npm run build`
Expected: Build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: cleanup unused imports and dead code"
```
