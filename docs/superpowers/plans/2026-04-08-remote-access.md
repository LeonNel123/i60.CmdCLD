# Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in web server to CmdCLD that allows remote control of Claude sessions from any browser on the network.

**Architecture:** Express + Socket.IO server embedded in the Electron main process, tapping into existing PtyManager/Settings/RecentDB. A vanilla HTML/CSS/JS SPA is served as the remote UI. PtyManager gains EventEmitter so the server can subscribe to PTY events without changing existing IPC flows.

**Tech Stack:** Express, Socket.IO, xterm.js (client-side), vanilla HTML/CSS/JS for remote UI

---

## File Structure

**New files:**
| File | Responsibility |
|------|---------------|
| `src/main/remote-server.ts` | Express + Socket.IO server, REST API, WebSocket event routing |
| `src/remote-ui/index.html` | SPA shell — dashboard + terminal views, client-side routing |
| `src/remote-ui/style.css` | Responsive dark theme, dashboard cards, terminal layout, mobile quick actions |
| `src/remote-ui/app.js` | Socket.IO client, dashboard logic, view switching, session management |
| `src/remote-ui/terminal-view.js` | xterm.js setup for full terminal, mobile fallback with read-only output |

**Modified files:**
| File | Change |
|------|--------|
| `src/main/pty-manager.ts` | Add `EventEmitter`, emit `data`/`exit`/`created` events, add `listAll()` method |
| `src/main/settings.ts` | Add `remoteAccess`, `remotePort`, `favoriteFolders` to `AppSettings` |
| `src/main/index.ts` | Instantiate `RemoteServer`, wire IPC for remote toggle, handle `session:created-remote` |
| `src/preload/index.ts` | Expose `onRemoteSessionCreated` listener |
| `src/renderer/src/App.tsx` | Listen for remote-created sessions, add to terminal state |
| `src/renderer/src/components/SettingsDialog.tsx` | Add Remote Access section (toggle, port, URLs, favorites) |
| `src/renderer/src/types/api.d.ts` | Add new API types for remote settings |
| `package.json` | Add `express`, `socket.io` dependencies |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install express and socket.io**

```bash
cd I:/i60-Projects/i60.CmdCLD
npm install express socket.io
```

- [ ] **Step 2: Verify dependencies in package.json**

Run: `node -e "const p = require('./package.json'); console.log(p.dependencies.express, p.dependencies['socket.io'])"`
Expected: Version numbers printed (e.g. `^5.1.0 ^4.8.0` or similar)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add express and socket.io dependencies"
```

---

### Task 2: Add EventEmitter to PtyManager

**Files:**
- Modify: `src/main/pty-manager.ts`

- [ ] **Step 1: Add EventEmitter import and extend PtyManager**

In `src/main/pty-manager.ts`, add `EventEmitter` import and make `PtyManager` extend it:

```typescript
import { EventEmitter } from 'events'
```

Change class declaration:

```typescript
export class PtyManager extends EventEmitter {
  private ptys = new Map<string, PtyEntry>()

  constructor() {
    super()
  }
```

- [ ] **Step 2: Emit events in the create method**

In the `create` method, after `this.ptys.set(id, entry)` (line 104), add:

```typescript
    this.ptys.set(id, entry)
    this.emit('created', { id, meta })
```

In the `onData` callback (inside `create`, after `entry.webContents.send`), add emit:

```typescript
    entry.dataDisposable = ptyProcess.onData((data) => {
      scrollback.push(data)
      this.emit('data', { id, data })
      try {
        if (!entry.webContents.isDestroyed()) {
          entry.webContents.send(`pty:data:${id}`, data)
        }
      } catch {}
    })
```

In the `onExit` callback, add emit before the delete:

```typescript
    entry.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode })
      try {
        if (!entry.webContents.isDestroyed()) {
          entry.webContents.send(`pty:exit:${id}`, exitCode)
        }
      } catch {}
      this.ptys.delete(id)
    })
```

- [ ] **Step 3: Add listAll() method**

After the existing `listByWebContents` method, add:

```typescript
  listAll(): TerminalMeta[] {
    return Array.from(this.ptys.values()).map((e) => e.meta)
  }

  has(id: string): boolean {
    return this.ptys.has(id)
  }
```

- [ ] **Step 4: Verify the app still builds**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/pty-manager.ts
git commit -m "feat: add EventEmitter to PtyManager for remote access"
```

---

### Task 3: Extend Settings

**Files:**
- Modify: `src/main/settings.ts`

- [ ] **Step 1: Add new fields to AppSettings interface**

```typescript
export interface AppSettings {
  editor: string
  claudeArgs: string
  askBeforeLaunch: boolean
  defaultViewMode: 'grid' | 'focused'
  notifyOnIdle: boolean
  projectsRoot: string
  remoteAccess: boolean
  remotePort: number
  favoriteFolders: string[]
}
```

- [ ] **Step 2: Add defaults**

```typescript
const DEFAULTS: AppSettings = {
  editor: 'code',
  claudeArgs: '--dangerously-skip-permissions',
  askBeforeLaunch: false,
  defaultViewMode: 'grid',
  notifyOnIdle: false,
  projectsRoot: '',
  remoteAccess: false,
  remotePort: 3456,
  favoriteFolders: [],
}
```

- [ ] **Step 3: Verify build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/main/settings.ts
git commit -m "feat: add remote access settings (remoteAccess, remotePort, favoriteFolders)"
```

---

### Task 4: Build RemoteServer

This is the core new file. It creates an Express + Socket.IO server that connects to PtyManager, Settings, and RecentDB.

**Files:**
- Create: `src/main/remote-server.ts`

- [ ] **Step 1: Create the RemoteServer class with start/stop**

Create `src/main/remote-server.ts`:

```typescript
import express from 'express'
import { createServer, Server as HttpServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import { join } from 'path'
import { existsSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { networkInterfaces } from 'os'
import { PtyManager, TerminalMeta } from './pty-manager'
import { Settings } from './settings'
import { RecentDB } from './recent-db'

export class RemoteServer {
  private app: ReturnType<typeof express> | null = null
  private httpServer: HttpServer | null = null
  private io: SocketServer | null = null
  private ptyManager: PtyManager
  private settings: Settings
  private recentDB: RecentDB
  private getWebContents: () => Electron.WebContents | null
  private startTime: number = 0

  constructor(opts: {
    ptyManager: PtyManager
    settings: Settings
    recentDB: RecentDB
    getWebContents: () => Electron.WebContents | null
  }) {
    this.ptyManager = opts.ptyManager
    this.settings = opts.settings
    this.recentDB = opts.recentDB
    this.getWebContents = opts.getWebContents
  }

  start(port: number): Promise<{ port: number; urls: string[] }> {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        reject(new Error('Server already running'))
        return
      }

      this.startTime = Date.now()
      this.app = express()
      this.app.use(express.json())
      this.httpServer = createServer(this.app)
      this.io = new SocketServer(this.httpServer, {
        cors: { origin: '*' },
      })

      this.setupStaticFiles()
      this.setupRestApi()
      this.setupSocketEvents()
      this.setupPtyListeners()

      this.httpServer.listen(port, '0.0.0.0', () => {
        const urls = this.getLocalUrls(port)
        resolve({ port, urls })
      })

      this.httpServer.on('error', (err) => {
        this.cleanup()
        reject(err)
      })
    })
  }

  stop(): void {
    this.cleanup()
  }

  isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening
  }

  private cleanup(): void {
    if (this.io) {
      this.io.close()
      this.io = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    this.app = null
    this.ptyManager.removeAllListeners()
  }

  private getLocalUrls(port: number): string[] {
    const urls: string[] = []
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          urls.push(`http://${net.address}:${port}`)
        }
      }
    }
    if (urls.length === 0) {
      urls.push(`http://localhost:${port}`)
    }
    return urls
  }

  private setupStaticFiles(): void {
    if (!this.app) return

    // Serve xterm.js and socket.io client from node_modules
    const nodeModules = join(__dirname, '../../node_modules')

    // In production (asar), node_modules is at app root
    const prodNodeModules = join(__dirname, '../../../node_modules')
    const nmPath = existsSync(nodeModules) ? nodeModules : prodNodeModules

    this.app.use('/vendor/xterm', express.static(join(nmPath, '@xterm/xterm')))
    this.app.use('/vendor/xterm-addon-fit', express.static(join(nmPath, '@xterm/addon-fit')))

    // Serve remote UI files
    // In dev: src/remote-ui, in production: bundled alongside out/
    const devUiPath = join(__dirname, '../../src/remote-ui')
    const prodUiPath = join(__dirname, '../remote-ui')
    const uiPath = existsSync(devUiPath) ? devUiPath : prodUiPath

    this.app.use(express.static(uiPath))
    this.app.get('/', (_req, res) => {
      res.sendFile(join(uiPath, 'index.html'))
    })
  }

  private setupRestApi(): void {
    if (!this.app) return
    const app = this.app

    // Status
    app.get('/api/status', (_req, res) => {
      res.json({
        version: require('../../package.json').version,
        uptime: Date.now() - this.startTime,
        sessions: this.ptyManager.listAll().length,
      })
    })

    // Sessions
    app.get('/api/sessions', (_req, res) => {
      const sessions = this.ptyManager.listAll()
      res.json(sessions)
    })

    app.post('/api/sessions', (req, res) => {
      const { path: cwd, claudeArgs } = req.body
      if (!cwd || typeof cwd !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      try {
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          res.status(400).json({ error: 'Invalid directory path' })
          return
        }
      } catch {
        res.status(400).json({ error: 'Invalid directory path' })
        return
      }

      const id = crypto.randomUUID()
      const name = cwd.split(/[\\/]/).pop() || cwd
      const meta: TerminalMeta = { id, path: cwd, name, color: '' }
      const wc = this.getWebContents()

      if (!wc) {
        res.status(500).json({ error: 'No active window' })
        return
      }

      this.ptyManager.create(id, cwd, wc, meta)

      // Launch claude in the PTY
      const args = claudeArgs || this.settings.get('claudeArgs')
      const launchCmd = args ? `claude ${args}\r` : 'claude\r'
      setTimeout(() => {
        this.ptyManager.write(id, launchCmd)
      }, 1000)

      // Notify renderer to add this session to its UI
      try {
        if (!wc.isDestroyed()) {
          wc.send('remote:session-created', { id, path: cwd, name, color: '', claudeArgs: args })
        }
      } catch {}

      res.json({ id, name, path: cwd })
    })

    app.delete('/api/sessions/:id', (req, res) => {
      const { id } = req.params
      if (!this.ptyManager.has(id)) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      this.ptyManager.kill(id)
      res.json({ ok: true })
    })

    app.get('/api/sessions/:id/scrollback', (req, res) => {
      const { id } = req.params
      const scrollback = this.ptyManager.getScrollback(id)
      res.json({ scrollback })
    })

    // Folders
    app.get('/api/folders/recent', async (_req, res) => {
      const folders = await this.recentDB.list()
      res.json(folders)
    })

    app.get('/api/folders/favorites', (_req, res) => {
      res.json(this.settings.get('favoriteFolders'))
    })

    app.put('/api/folders/favorites', (req, res) => {
      const { folders } = req.body
      if (!Array.isArray(folders)) {
        res.status(400).json({ error: 'folders must be an array' })
        return
      }
      this.settings.set('favoriteFolders', folders)
      res.json({ ok: true })
    })

    // Settings
    app.get('/api/settings', (_req, res) => {
      const all = this.settings.getAll()
      res.json({ claudeArgs: all.claudeArgs })
    })

    // Image upload
    app.post('/api/sessions/:id/upload-image', (req, res) => {
      const { id } = req.params
      const meta = this.ptyManager.getMeta(id)
      if (!meta) {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const buffer = Buffer.concat(chunks)
        const screenshotsDir = join(meta.path, '.screenshots')
        mkdirSync(screenshotsDir, { recursive: true })

        const now = new Date()
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}m${String(now.getSeconds()).padStart(2, '0')}s`
        const filePath = join(screenshotsDir, `screenshot-${stamp}.png`)
        writeFileSync(filePath, buffer)

        // Send the file path to the PTY as input
        this.ptyManager.write(id, filePath)

        res.json({ path: filePath })
      })
    })
  }

  private setupSocketEvents(): void {
    if (!this.io) return

    this.io.on('connection', (socket) => {
      // Send current session list on connect
      socket.emit('sessions:changed', this.ptyManager.listAll())

      // Handle input from remote client
      socket.on('session:input', ({ id, data }: { id: string; data: string }) => {
        if (this.ptyManager.has(id)) {
          this.ptyManager.write(id, data)
        }
      })

      // Handle resize from remote client
      socket.on('session:resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
        if (this.ptyManager.has(id)) {
          this.ptyManager.resize(id, cols, rows)
        }
      })
    })
  }

  private setupPtyListeners(): void {
    this.ptyManager.on('data', ({ id, data }: { id: string; data: string }) => {
      if (this.io) {
        this.io.emit('session:output', { id, data })
      }
    })

    this.ptyManager.on('exit', ({ id, exitCode }: { id: string; exitCode: number }) => {
      if (this.io) {
        this.io.emit('session:exit', { id, exitCode })
        this.io.emit('sessions:changed', this.ptyManager.listAll())
      }
    })

    this.ptyManager.on('created', ({ id, meta }: { id: string; meta: TerminalMeta }) => {
      if (this.io) {
        this.io.emit('session:created', meta)
        this.io.emit('sessions:changed', this.ptyManager.listAll())
      }
    })
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds. Note: if `externalizeDepsPlugin()` causes issues with express/socket.io, that's expected — these are Node.js deps and should be externalized by default.

- [ ] **Step 3: Commit**

```bash
git add src/main/remote-server.ts
git commit -m "feat: add RemoteServer class (Express + Socket.IO)"
```

---

### Task 5: Wire RemoteServer into Main Process

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import RemoteServer and add instance**

At the top of `src/main/index.ts`, add import:

```typescript
import { RemoteServer } from './remote-server'
```

After the `settings` initialization (around line 42), add:

```typescript
let remoteServer: RemoteServer
```

Inside the `try` block where services are created (after `settings = new Settings(...)` around line 42), add:

```typescript
  remoteServer = new RemoteServer({
    ptyManager,
    settings,
    recentDB,
    getWebContents: () => {
      const list = registry.list()
      if (list.length === 0) return null
      return registry.getWebContents(list[0].id) || null
    },
  })
```

- [ ] **Step 2: Add IPC handlers for remote toggle**

After the existing settings IPC handlers (around line 259), add:

```typescript
// Remote access
ipcMain.handle('remote:toggle', async (_event, enabled: boolean) => {
  if (enabled) {
    const port = settings.get('remotePort')
    try {
      const result = await remoteServer.start(port)
      return { ok: true, urls: result.urls, port: result.port }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Failed to start server' }
    }
  } else {
    remoteServer.stop()
    return { ok: true }
  }
})

ipcMain.handle('remote:status', () => {
  return {
    running: remoteServer.isRunning(),
    port: settings.get('remotePort'),
  }
})
```

- [ ] **Step 3: Auto-start remote server if enabled**

In `app.whenReady().then(...)` (around line 323), after `createWindow()`, add:

```typescript
    // Auto-start remote server if enabled
    if (settings.get('remoteAccess')) {
      const port = settings.get('remotePort')
      remoteServer.start(port).then((result) => {
        log(`Remote server started on port ${result.port}: ${result.urls.join(', ')}`)
      }).catch((err) => {
        log(`Remote server failed to start: ${err.message}`)
      })
    }
```

- [ ] **Step 4: Stop remote server on app quit**

In the `window-all-closed` handler (around line 344), before `app.quit()`, add:

```typescript
  remoteServer.stop()
```

- [ ] **Step 5: Verify build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire RemoteServer into main process with IPC toggle"
```

---

### Task 6: Update Preload and Renderer Types

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/api.d.ts`

- [ ] **Step 1: Add remote IPC methods to preload**

In `src/preload/index.ts`, add these to the `contextBridge.exposeInMainWorld('api', {` object:

```typescript
  // Remote access
  remoteToggle: (enabled: boolean): Promise<{ ok: boolean; urls?: string[]; port?: number; error?: string }> =>
    ipcRenderer.invoke('remote:toggle', enabled),

  remoteStatus: (): Promise<{ running: boolean; port: number }> =>
    ipcRenderer.invoke('remote:status'),

  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, session: any): void => callback(session)
    ipcRenderer.on('remote:session-created', listener)
    return () => { ipcRenderer.removeListener('remote:session-created', listener) }
  },
```

- [ ] **Step 2: Update TypeScript types**

In `src/renderer/src/types/api.d.ts`, add to the `ElectronAPI` interface:

```typescript
  remoteToggle: (enabled: boolean) => Promise<{ ok: boolean; urls?: string[]; port?: number; error?: string }>
  remoteStatus: () => Promise<{ running: boolean; port: number }>
  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string }) => void) => () => void
```

- [ ] **Step 3: Verify build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/types/api.d.ts
git commit -m "feat: add remote access IPC to preload and renderer types"
```

---

### Task 7: Listen for Remote Sessions in App.tsx

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add listener for remote-created sessions**

In `App.tsx`, inside the component, after the existing `useEffect` that loads settings (around line 72), add a new effect:

```typescript
  // Listen for sessions created remotely
  useEffect(() => {
    const unsub = window.api.onRemoteSessionCreated((session) => {
      setTerminals((prev) => {
        // Skip if already exists
        if (prev.find((t) => t.id === session.id)) return prev
        const usedColors = prev.map((t) => t.color)
        const newEntry: TerminalEntry = {
          id: session.id,
          path: session.path,
          name: session.name,
          color: session.color || assignColor(usedColors),
          claudeArgs: session.claudeArgs,
        }
        const next = [...prev, newEntry]
        setLayouts(calculateLayout(next.length).map((pos, i) => ({
          ...pos,
          i: next[i].id,
        })))
        return next
      })
    })
    return unsub
  }, [])
```

- [ ] **Step 2: Verify build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: renderer listens for remote-created sessions"
```

---

### Task 8: Add Remote Access Section to Settings Dialog

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Add remote state variables**

In `SettingsDialog`, add state after the existing `loaded` state:

```typescript
  const [remoteAccess, setRemoteAccess] = useState(false)
  const [remotePort, setRemotePort] = useState(3456)
  const [remoteUrls, setRemoteUrls] = useState<string[]>([])
  const [remoteError, setRemoteError] = useState('')
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([])
  const [newFavorite, setNewFavorite] = useState('')
```

- [ ] **Step 2: Load remote settings on mount**

In the existing `useEffect` that calls `settingsGetAll`, extend the `.then()` callback to also set remote fields:

```typescript
  useEffect(() => {
    window.api.settingsGetAll().then((s: any) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
      setDefaultViewMode(s.defaultViewMode)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      setRemoteAccess(s.remoteAccess ?? false)
      setRemotePort(s.remotePort ?? 3456)
      setFavoriteFolders(s.favoriteFolders ?? [])
      setLoaded(true)
    })
    window.api.remoteStatus().then((status) => {
      if (status.running) {
        setRemoteAccess(true)
      }
    }).catch(() => {})
  }, [])
```

- [ ] **Step 3: Add remote toggle handler**

Add this function inside the component:

```typescript
  const handleRemoteToggle = async (enabled: boolean) => {
    setRemoteError('')
    if (enabled) {
      window.api.settingsSet('remoteAccess', true)
      window.api.settingsSet('remotePort', remotePort)
      const result = await window.api.remoteToggle(true)
      if (result.ok) {
        setRemoteAccess(true)
        setRemoteUrls(result.urls || [])
      } else {
        setRemoteAccess(false)
        setRemoteError(result.error || 'Failed to start')
        window.api.settingsSet('remoteAccess', false)
      }
    } else {
      await window.api.remoteToggle(false)
      setRemoteAccess(false)
      setRemoteUrls([])
      window.api.settingsSet('remoteAccess', false)
    }
  }

  const handleAddFavorite = async () => {
    const folder = await window.api.selectFolder()
    if (folder && !favoriteFolders.includes(folder)) {
      const updated = [...favoriteFolders, folder]
      setFavoriteFolders(updated)
    }
  }

  const handleRemoveFavorite = (path: string) => {
    setFavoriteFolders((prev) => prev.filter((f) => f !== path))
  }
```

- [ ] **Step 4: Update the save function**

Extend the existing `save` function to include remote settings:

```typescript
  const save = () => {
    window.api.settingsSet('claudeArgs', claudeArgs)
    window.api.settingsSet('askBeforeLaunch', askBeforeLaunch)
    window.api.settingsSet('defaultViewMode', defaultViewMode)
    window.api.settingsSet('notifyOnIdle', notifyOnIdle)
    window.api.settingsSet('projectsRoot', projectsRoot)
    window.api.settingsSet('remotePort', remotePort)
    window.api.settingsSet('favoriteFolders', favoriteFolders)
    onClose()
  }
```

- [ ] **Step 5: Add Remote Access UI section**

After the "Projects Root" section and before the buttons `div`, add:

```tsx
        {/* Remote Access */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '16px', marginTop: '16px' }}>
          <h4 style={{ color: '#e0e0e0', margin: '0 0 12px', fontSize: '13px', fontFamily: 'monospace' }}>
            Remote Access
          </h4>

          {/* Toggle */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'monospace',
            }}>
              <input
                type="checkbox"
                checked={remoteAccess}
                onChange={(e) => handleRemoteToggle(e.target.checked)}
                style={{ accentColor: '#22c55e' }}
              />
              Enable Remote Access
            </label>
          </div>

          {/* Port */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
              Port
            </label>
            <input
              type="number"
              value={remotePort}
              onChange={(e) => setRemotePort(parseInt(e.target.value) || 3456)}
              disabled={remoteAccess}
              style={{
                width: '100px', background: '#0d1117', border: '1px solid #333',
                borderRadius: '4px', padding: '6px 10px', color: '#e0e0e0',
                fontSize: '12px', fontFamily: 'Consolas, monospace', outline: 'none',
                opacity: remoteAccess ? 0.5 : 1,
              }}
            />
            {remoteAccess && (
              <span style={{ color: '#666', fontSize: '10px', fontFamily: 'monospace', marginLeft: '8px' }}>
                Disable to change port
              </span>
            )}
          </div>

          {/* URLs */}
          {remoteAccess && remoteUrls.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
                Connect from
              </label>
              {remoteUrls.map((url) => (
                <div key={url} style={{
                  color: '#22c55e', fontSize: '12px', fontFamily: 'Consolas, monospace',
                  padding: '2px 0', cursor: 'pointer',
                }} onClick={() => navigator.clipboard.writeText(url)} title="Click to copy">
                  {url}
                </div>
              ))}
              <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>
                Click to copy. Open in any browser on your network.
              </div>
            </div>
          )}

          {/* Error */}
          {remoteError && (
            <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'monospace', marginBottom: '12px' }}>
              {remoteError}
            </div>
          )}

          {/* Favorite folders */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
              Favorite Folders (for remote session creation)
            </label>
            {favoriteFolders.map((f) => (
              <div key={f} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 0',
              }}>
                <span style={{ color: '#ccc', fontSize: '11px', fontFamily: 'Consolas, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f}
                </span>
                <button onClick={() => handleRemoveFavorite(f)} style={{
                  background: 'none', border: 'none', color: '#666', cursor: 'pointer',
                  fontSize: '14px', padding: '0 4px', flexShrink: 0,
                }}>×</button>
              </div>
            ))}
            <button onClick={handleAddFavorite} style={{
              background: '#ffffff08', border: '1px solid #333', borderRadius: '4px',
              padding: '4px 10px', color: '#888', fontSize: '11px', fontFamily: 'monospace',
              cursor: 'pointer', marginTop: '4px',
            }}>
              + Add Folder
            </button>
          </div>
        </div>
```

- [ ] **Step 6: Verify build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SettingsDialog.tsx
git commit -m "feat: add Remote Access section to Settings dialog"
```

---

### Task 9: Create Remote UI — HTML Shell

**Files:**
- Create: `src/remote-ui/index.html`

- [ ] **Step 1: Create the SPA shell**

Create `src/remote-ui/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CmdCLD Remote</title>
  <link rel="stylesheet" href="/vendor/xterm/css/xterm.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app">
    <!-- Dashboard View -->
    <div id="dashboard-view">
      <header id="status-bar">
        <span id="connection-status" class="status-dot disconnected">Connecting...</span>
        <span id="session-count">0 sessions</span>
      </header>

      <div id="session-cards"></div>

      <div id="new-session-bar">
        <button id="new-session-btn" class="btn-primary">+ New Session</button>
      </div>

      <!-- New session modal -->
      <div id="new-session-modal" class="modal hidden">
        <div class="modal-backdrop"></div>
        <div class="modal-content">
          <h3>New Session</h3>
          <div id="folder-sections"></div>
          <div class="modal-footer">
            <button id="cancel-new-session" class="btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Terminal View -->
    <div id="terminal-view" class="hidden">
      <header id="terminal-header">
        <div class="terminal-header-left">
          <button id="back-btn" class="btn-icon">← Back</button>
          <span id="terminal-name"></span>
          <span id="terminal-status"></span>
        </div>
        <div class="terminal-header-right">
          <button id="ctrl-c-btn" class="btn-small">Ctrl+C</button>
          <button id="kill-btn" class="btn-small btn-danger">Kill</button>
        </div>
      </header>

      <!-- Desktop: full xterm.js terminal -->
      <div id="terminal-container"></div>

      <!-- Mobile: read-only output + quick actions + input -->
      <div id="mobile-terminal">
        <div id="mobile-output"></div>
        <div id="quick-actions">
          <button class="quick-btn" data-input="yes&#10;">yes</button>
          <button class="quick-btn" data-input="no&#10;">no</button>
          <button class="quick-btn" data-input="\x03">Ctrl+C</button>
          <button class="quick-btn" data-input="/compact&#10;">/compact</button>
          <button class="quick-btn" data-input="/clear&#10;">/clear</button>
        </div>
        <div id="mobile-input-bar">
          <input type="text" id="mobile-input" placeholder="Type a message...">
          <button id="mobile-send-btn" class="btn-primary">Send</button>
          <label id="mobile-image-btn" class="btn-icon" title="Upload image">
            <input type="file" accept="image/*" id="mobile-image-input" hidden>
            📷
          </label>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/vendor/xterm/lib/xterm.js"></script>
  <script src="/vendor/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
  <script src="/app.js"></script>
  <script src="/terminal-view.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/remote-ui/index.html
git commit -m "feat: add remote UI HTML shell"
```

---

### Task 10: Create Remote UI — CSS

**Files:**
- Create: `src/remote-ui/style.css`

- [ ] **Step 1: Create the responsive dark theme**

Create `src/remote-ui/style.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #111;
  color: #e0e0e0;
  height: 100vh;
  overflow: hidden;
}

#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Status bar */
#status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #1a1a2e;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.status-dot::before {
  content: '●';
  margin-right: 6px;
}

.status-dot.connected { color: #10b981; }
.status-dot.disconnected { color: #ef4444; }
.status-dot.reconnecting { color: #f59e0b; }

#session-count {
  color: #888;
  font-size: 12px;
}

/* Session cards */
#session-cards {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-card {
  background: #1e1e2e;
  border-left: 3px solid #666;
  border-radius: 4px;
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: background 0.15s;
}

.session-card:hover {
  background: #252540;
}

.session-card .card-info h4 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 2px;
}

.session-card .card-info .card-path {
  color: #888;
  font-size: 11px;
  font-family: 'Consolas', monospace;
}

.session-card .card-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-card .card-status .status-label {
  font-size: 11px;
}

.session-card .card-status .status-label.busy {
  color: #f59e0b;
}

.session-card .card-status .status-label.idle {
  color: #10b981;
}

.session-card .card-status .chevron {
  color: #666;
  font-size: 18px;
}

/* New session bar */
#new-session-bar {
  padding: 8px 12px;
  border-top: 1px solid #333;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}

/* Buttons */
.btn-primary {
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 20px;
  font-size: 13px;
  cursor: pointer;
}

.btn-primary:hover { background: #5558e6; }

.btn-secondary {
  background: #333;
  color: #ccc;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
}

.btn-small {
  background: #1e1e2e;
  color: #888;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

.btn-small:hover { border-color: #666; color: #ccc; }
.btn-danger { color: #ef4444; }
.btn-danger:hover { border-color: #ef4444; }
.btn-icon {
  background: none;
  border: none;
  color: #6366f1;
  cursor: pointer;
  font-size: 13px;
}

/* Modal */
.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.modal.hidden { display: none; }

.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
}

.modal-content {
  position: relative;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 20px;
  max-width: 420px;
  width: 90%;
  margin: 15vh auto;
  max-height: 70vh;
  overflow-y: auto;
}

.modal-content h3 {
  font-size: 14px;
  font-family: monospace;
  margin-bottom: 16px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.folder-section-label {
  color: #888;
  font-size: 10px;
  text-transform: uppercase;
  margin: 12px 0 6px;
  font-family: monospace;
}

.folder-item {
  padding: 8px 10px;
  background: #0d1117;
  border: 1px solid #333;
  border-radius: 4px;
  margin-bottom: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: 'Consolas', monospace;
  transition: border-color 0.15s;
}

.folder-item:hover {
  border-color: #6366f1;
  color: #fff;
}

/* Terminal view */
#terminal-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

#terminal-view.hidden { display: none; }

#terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #1a1a2e;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.terminal-header-right {
  display: flex;
  gap: 6px;
}

#terminal-name {
  font-weight: 600;
  font-size: 13px;
}

#terminal-status {
  font-size: 11px;
}

#terminal-container {
  flex: 1;
  background: #0d0d0d;
  overflow: hidden;
}

/* Mobile terminal */
#mobile-terminal { display: none; }

#mobile-output {
  flex: 1;
  background: #0d0d0d;
  padding: 8px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  color: #d4d4d4;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

#quick-actions {
  display: flex;
  gap: 6px;
  padding: 8px;
  background: #13131f;
  border-top: 1px solid #333;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.quick-btn {
  background: #1e1e2e;
  color: #ccc;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: monospace;
  cursor: pointer;
}

.quick-btn:hover { border-color: #6366f1; }

#mobile-input-bar {
  display: flex;
  gap: 6px;
  padding: 8px;
  background: #1a1a2e;
  border-top: 1px solid #333;
  flex-shrink: 0;
}

#mobile-input {
  flex: 1;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px 10px;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}

#mobile-send-btn {
  padding: 8px 14px;
  font-size: 13px;
}

#mobile-image-btn {
  display: flex;
  align-items: center;
  font-size: 18px;
  cursor: pointer;
}

/* Responsive: mobile */
@media (max-width: 768px) {
  #terminal-container { display: none; }
  #mobile-terminal {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
}

/* Desktop: hide mobile terminal */
@media (min-width: 769px) {
  #mobile-terminal { display: none !important; }
  #terminal-container { display: block; }
}

/* Empty state */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #555;
  font-size: 14px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/remote-ui/style.css
git commit -m "feat: add remote UI responsive dark theme CSS"
```

---

### Task 11: Create Remote UI — App Logic

**Files:**
- Create: `src/remote-ui/app.js`

- [ ] **Step 1: Create the main app logic**

Create `src/remote-ui/app.js`:

```javascript
// CmdCLD Remote — Main App Logic
(function () {
  'use strict'

  // State
  let sessions = []
  let currentSessionId = null
  let socket = null
  let busyTimers = {}
  let busyState = {}

  // DOM refs
  const dashboardView = document.getElementById('dashboard-view')
  const terminalView = document.getElementById('terminal-view')
  const sessionCards = document.getElementById('session-cards')
  const sessionCount = document.getElementById('session-count')
  const connectionStatus = document.getElementById('connection-status')
  const newSessionBtn = document.getElementById('new-session-btn')
  const newSessionModal = document.getElementById('new-session-modal')
  const folderSections = document.getElementById('folder-sections')
  const cancelNewSession = document.getElementById('cancel-new-session')
  const backBtn = document.getElementById('back-btn')
  const terminalName = document.getElementById('terminal-name')
  const terminalStatus = document.getElementById('terminal-status')
  const ctrlCBtn = document.getElementById('ctrl-c-btn')
  const killBtn = document.getElementById('kill-btn')

  // Connect Socket.IO
  function connect() {
    socket = io({ reconnection: true, reconnectionDelay: 1000 })

    socket.on('connect', () => {
      connectionStatus.textContent = 'Connected'
      connectionStatus.className = 'status-dot connected'
    })

    socket.on('disconnect', () => {
      connectionStatus.textContent = 'Disconnected'
      connectionStatus.className = 'status-dot disconnected'
    })

    socket.on('reconnecting', () => {
      connectionStatus.textContent = 'Reconnecting...'
      connectionStatus.className = 'status-dot reconnecting'
    })

    socket.on('sessions:changed', (list) => {
      sessions = list
      renderDashboard()
    })

    socket.on('session:created', () => {
      refreshSessions()
    })

    socket.on('session:output', ({ id, data }) => {
      trackBusy(id, true)
      if (id === currentSessionId) {
        window.CmdCLD_Terminal.onData(data)
      }
    })

    socket.on('session:exit', ({ id, exitCode }) => {
      trackBusy(id, false)
      if (id === currentSessionId) {
        window.CmdCLD_Terminal.onExit(exitCode)
      }
      refreshSessions()
    })
  }

  // Activity tracking
  function trackBusy(id, dataReceived) {
    if (dataReceived) {
      busyState[id] = true
      clearTimeout(busyTimers[id])
      busyTimers[id] = setTimeout(() => {
        busyState[id] = false
        renderDashboard()
      }, 2000)
      renderDashboard()
    }
  }

  // Fetch sessions via REST (fallback/refresh)
  async function refreshSessions() {
    try {
      const res = await fetch('/api/sessions')
      sessions = await res.json()
      renderDashboard()
    } catch {}
  }

  // Render dashboard
  function renderDashboard() {
    sessionCount.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`

    if (sessions.length === 0) {
      sessionCards.innerHTML = '<div class="empty-state">No active sessions</div>'
      return
    }

    sessionCards.innerHTML = sessions.map((s) => {
      const busy = busyState[s.id]
      const statusClass = busy ? 'busy' : 'idle'
      const statusText = busy ? '⟳ Working...' : '● Idle'
      return `
        <div class="session-card" data-id="${s.id}" style="border-left-color: ${s.color || '#6366f1'}">
          <div class="card-info">
            <h4>${escapeHtml(s.name)}</h4>
            <div class="card-path">${escapeHtml(s.path)}</div>
          </div>
          <div class="card-status">
            <span class="status-label ${statusClass}">${statusText}</span>
            <span class="chevron">›</span>
          </div>
        </div>
      `
    }).join('')

    // Attach click handlers
    sessionCards.querySelectorAll('.session-card').forEach((card) => {
      card.addEventListener('click', () => {
        openTerminal(card.dataset.id)
      })
    })
  }

  // Open terminal view for a session
  async function openTerminal(id) {
    currentSessionId = id
    const session = sessions.find((s) => s.id === id)
    if (!session) return

    terminalName.textContent = session.name
    terminalStatus.textContent = busyState[id] ? '⟳ Working' : '● Idle'
    terminalStatus.style.color = busyState[id] ? '#f59e0b' : '#10b981'

    dashboardView.classList.add('hidden')
    terminalView.classList.remove('hidden')

    // Fetch scrollback and init terminal
    try {
      const res = await fetch(`/api/sessions/${id}/scrollback`)
      const { scrollback } = await res.json()
      window.CmdCLD_Terminal.open(id, scrollback, socket)
    } catch {
      window.CmdCLD_Terminal.open(id, '', socket)
    }
  }

  // Back to dashboard
  function closTerminal() {
    window.CmdCLD_Terminal.close()
    currentSessionId = null
    terminalView.classList.add('hidden')
    dashboardView.classList.remove('hidden')
    dashboardView.style.display = ''
    refreshSessions()
  }

  // New session modal
  async function showNewSessionModal() {
    newSessionModal.classList.remove('hidden')

    // Fetch favorites + recents
    const [favRes, recRes] = await Promise.all([
      fetch('/api/folders/favorites').then((r) => r.json()).catch(() => []),
      fetch('/api/folders/recent').then((r) => r.json()).catch(() => []),
    ])

    let html = ''

    if (favRes.length > 0) {
      html += '<div class="folder-section-label">Favorites</div>'
      html += favRes.map((f) => `<div class="folder-item" data-path="${escapeHtml(f)}">${escapeHtml(f.split(/[\\/]/).pop() || f)}<div style="color:#666;font-size:10px;margin-top:2px">${escapeHtml(f)}</div></div>`).join('')
    }

    if (recRes.length > 0) {
      html += '<div class="folder-section-label">Recent</div>'
      html += recRes.map((f) => `<div class="folder-item" data-path="${escapeHtml(f.path)}">${escapeHtml(f.name)}<div style="color:#666;font-size:10px;margin-top:2px">${escapeHtml(f.path)}</div></div>`).join('')
    }

    if (favRes.length === 0 && recRes.length === 0) {
      html = '<div class="empty-state">No folders configured. Add favorites in the app settings.</div>'
    }

    folderSections.innerHTML = html

    folderSections.querySelectorAll('.folder-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const path = item.dataset.path
        newSessionModal.classList.add('hidden')
        try {
          await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
          })
        } catch {}
      })
    })
  }

  // Event listeners
  newSessionBtn.addEventListener('click', showNewSessionModal)
  cancelNewSession.addEventListener('click', () => newSessionModal.classList.add('hidden'))
  newSessionModal.querySelector('.modal-backdrop').addEventListener('click', () => newSessionModal.classList.add('hidden'))
  backBtn.addEventListener('click', closTerminal)

  ctrlCBtn.addEventListener('click', () => {
    if (currentSessionId && socket) {
      socket.emit('session:input', { id: currentSessionId, data: '\x03' })
    }
  })

  killBtn.addEventListener('click', async () => {
    if (!currentSessionId) return
    if (!confirm('Kill this session?')) return
    try {
      await fetch(`/api/sessions/${currentSessionId}`, { method: 'DELETE' })
      closTerminal()
    } catch {}
  })

  // Utils
  function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // Expose for terminal-view.js
  window.CmdCLD_App = { closTerminal, refreshSessions }

  // Init
  connect()
  refreshSessions()
})()
```

- [ ] **Step 2: Commit**

```bash
git add src/remote-ui/app.js
git commit -m "feat: add remote UI app logic (Socket.IO, dashboard, navigation)"
```

---

### Task 12: Create Remote UI — Terminal View

**Files:**
- Create: `src/remote-ui/terminal-view.js`

- [ ] **Step 1: Create the terminal view module**

Create `src/remote-ui/terminal-view.js`:

```javascript
// CmdCLD Remote — Terminal View (xterm.js desktop + mobile fallback)
(function () {
  'use strict'

  const terminalContainer = document.getElementById('terminal-container')
  const mobileOutput = document.getElementById('mobile-output')
  const mobileInput = document.getElementById('mobile-input')
  const mobileSendBtn = document.getElementById('mobile-send-btn')
  const mobileImageInput = document.getElementById('mobile-image-input')
  const quickActions = document.getElementById('quick-actions')

  let term = null
  let fitAddon = null
  let currentId = null
  let currentSocket = null
  let resizeObserver = null
  let mobileBuffer = ''
  const MAX_MOBILE_BUFFER = 100000

  function isMobile() {
    return window.innerWidth <= 768
  }

  function open(id, scrollback, socket) {
    close()
    currentId = id
    currentSocket = socket

    if (!isMobile()) {
      openDesktop(scrollback)
    } else {
      openMobile(scrollback)
    }
  }

  function openDesktop(scrollback) {
    term = new Terminal({
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
    })

    fitAddon = new FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalContainer)

    // Write scrollback
    if (scrollback) {
      term.write(scrollback)
    }

    fitAddon.fit()

    // Send resize to server
    sendResize()

    // Handle user input
    term.onData((data) => {
      if (currentSocket && currentId) {
        currentSocket.emit('session:input', { id: currentId, data })
      }
    })

    // Handle paste with image support
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.ctrlKey && ev.key === 'v' && ev.type === 'keydown') {
        handlePaste()
        return false
      }
      return true
    })

    // Resize observer
    resizeObserver = new ResizeObserver(() => {
      if (fitAddon && term) {
        fitAddon.fit()
        sendResize()
      }
    })
    resizeObserver.observe(terminalContainer)
  }

  function openMobile(scrollback) {
    mobileBuffer = scrollback || ''
    renderMobileOutput()
  }

  function renderMobileOutput() {
    // Trim buffer if too large
    if (mobileBuffer.length > MAX_MOBILE_BUFFER) {
      mobileBuffer = mobileBuffer.slice(-MAX_MOBILE_BUFFER)
    }
    // Strip ANSI codes for mobile display
    const clean = mobileBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    mobileOutput.textContent = clean
    mobileOutput.scrollTop = mobileOutput.scrollHeight
  }

  function sendResize() {
    if (term && currentSocket && currentId) {
      const dims = { cols: term.cols, rows: term.rows }
      currentSocket.emit('session:resize', { id: currentId, ...dims })
    }
  }

  function onData(data) {
    if (!isMobile() && term) {
      term.write(data)
    } else {
      mobileBuffer += data
      renderMobileOutput()
    }
  }

  function onExit(exitCode) {
    const msg = `\r\n[Session exited with code ${exitCode}]`
    if (!isMobile() && term) {
      term.write(msg)
    } else {
      mobileBuffer += msg
      renderMobileOutput()
    }
  }

  function close() {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (term) {
      term.dispose()
      term = null
      fitAddon = null
    }
    terminalContainer.innerHTML = ''
    mobileOutput.textContent = ''
    mobileBuffer = ''
    currentId = null
    currentSocket = null
  }

  async function handlePaste() {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        // Check for image
        const imageType = item.types.find((t) => t.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          await uploadImage(blob)
          return
        }
        // Fall back to text
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain')
          const text = await blob.text()
          if (currentSocket && currentId) {
            currentSocket.emit('session:input', { id: currentId, data: text })
          }
          return
        }
      }
    } catch {
      // Fallback: try text-only paste
      try {
        const text = await navigator.clipboard.readText()
        if (text && currentSocket && currentId) {
          currentSocket.emit('session:input', { id: currentId, data: text })
        }
      } catch {}
    }
  }

  async function uploadImage(blob) {
    if (!currentId) return
    try {
      const res = await fetch(`/api/sessions/${currentId}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      })
      const { path } = await res.json()
      // Path is automatically sent to the PTY by the server
    } catch {}
  }

  // Mobile input handling
  mobileSendBtn.addEventListener('click', () => {
    const text = mobileInput.value
    if (text && currentSocket && currentId) {
      currentSocket.emit('session:input', { id: currentId, data: text + '\n' })
      mobileInput.value = ''
    }
  })

  mobileInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      mobileSendBtn.click()
    }
  })

  // Quick action buttons
  quickActions.querySelectorAll('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.dataset.input
      if (input && currentSocket && currentId) {
        // Decode HTML entities for newlines
        const decoded = input.replace(/&#10;/g, '\n')
        currentSocket.emit('session:input', { id: currentId, data: decoded })
      }
    })
  })

  // Mobile image upload
  mobileImageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    await uploadImage(file)
    mobileImageInput.value = ''
  })

  // Expose globally
  window.CmdCLD_Terminal = { open, close, onData, onExit }
})()
```

- [ ] **Step 2: Commit**

```bash
git add src/remote-ui/terminal-view.js
git commit -m "feat: add remote UI terminal view (xterm.js desktop + mobile fallback)"
```

---

### Task 13: Bundle Remote UI for Production

**Files:**
- Modify: `electron.vite.config.ts`
- Modify: `package.json` (build config)

- [ ] **Step 1: Copy remote-ui to output on build**

The remote UI is plain static files — they need to be available at runtime. In `electron.vite.config.ts`, add a copy plugin for the main process build:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

function copyRemoteUi() {
  return {
    name: 'copy-remote-ui',
    closeBundle() {
      const src = join(__dirname, 'src/remote-ui')
      const dest = join(__dirname, 'out/remote-ui')
      mkdirSync(dest, { recursive: true })
      for (const file of readdirSync(src)) {
        copyFileSync(join(src, file), join(dest, file))
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyRemoteUi()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
```

- [ ] **Step 2: Ensure express and socket.io are not bundled into asar**

In `package.json`, update the `build` section's `asarUnpack`:

```json
    "asarUnpack": [
      "node_modules/node-pty/**",
      "node_modules/express/**",
      "node_modules/socket.io/**"
    ]
```

Also add the remote-ui output to files:

```json
    "files": [
      "out/**/*"
    ],
```

This already includes `out/remote-ui/` since the copy plugin puts files there.

- [ ] **Step 3: Verify full build**

Run: `cd I:/i60-Projects/i60.CmdCLD && npx electron-vite build`
Expected: Build succeeds, and `out/remote-ui/` contains `index.html`, `style.css`, `app.js`, `terminal-view.js`

- [ ] **Step 4: Commit**

```bash
git add electron.vite.config.ts package.json
git commit -m "feat: bundle remote UI for production builds"
```

---

### Task 14: Integration Test — Manual

- [ ] **Step 1: Start dev mode**

Run: `cd I:/i60-Projects/i60.CmdCLD && npm run dev`

- [ ] **Step 2: Enable remote access**

In the Electron app, open Settings → Remote Access → toggle on. Verify:
- URLs are displayed (e.g. `http://192.168.x.x:3456`)
- No errors shown

- [ ] **Step 3: Test dashboard from browser**

Open the URL in a separate browser. Verify:
- "Connected" status shown
- "0 sessions" displayed
- "New Session" button visible

- [ ] **Step 4: Create a session locally**

In the Electron app, add a folder. Verify:
- The remote browser shows the new session card
- Card shows session name, path, busy/idle status

- [ ] **Step 5: Open session in remote browser**

Click the session card. Verify:
- Desktop: xterm.js terminal loads with scrollback
- Terminal output streams live

- [ ] **Step 6: Send input remotely**

Type in the remote terminal. Verify:
- Input reaches the PTY
- Claude responds
- Response streams back to remote terminal

- [ ] **Step 7: Create session remotely**

Go back to dashboard, click "New Session", pick a folder. Verify:
- Session appears in remote dashboard
- Session also appears in the local Electron app

- [ ] **Step 8: Test mobile layout**

Open browser dev tools, toggle device toolbar (mobile viewport). Verify:
- Session cards stack vertically
- Terminal view shows read-only output + quick action buttons + text input
- Quick action buttons send correct input

- [ ] **Step 9: Commit final state if needed**

```bash
git add -A
git commit -m "feat: remote access — integration tested"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | Install express + socket.io |
| 2 | Add EventEmitter to PtyManager |
| 3 | Extend Settings with remote fields |
| 4 | Build RemoteServer (Express + Socket.IO + REST API) |
| 5 | Wire RemoteServer into main process |
| 6 | Update preload + renderer types |
| 7 | Listen for remote sessions in App.tsx |
| 8 | Add Remote Access UI to Settings dialog |
| 9 | Create remote UI HTML shell |
| 10 | Create remote UI CSS |
| 11 | Create remote UI app logic |
| 12 | Create remote UI terminal view |
| 13 | Bundle remote UI for production |
| 14 | Integration test |
