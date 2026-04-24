import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, Menu, powerSaveBlocker } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import { appendFileSync, existsSync, statSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import * as os from 'os'
import { PtyManager } from './pty-manager'
import { Store } from './store'
import { WindowRegistry } from './window-registry'
import { RecentDB } from './recent-db'
import { Settings } from './settings'
import { detectEditors, getDefaultEditor } from './editor-detect'
import { RemoteServer } from './remote-server'
import { hardenGlobalSettings, trustFolder, readClaudeConfig, writeClaudeConfig } from './claude-config'
import { getStatus as tsGetStatus, getServeStatus as tsGetServeStatus, startServe as tsStartServe, stopServe as tsStopServe } from './tailscale'
import type { TerminalMeta } from './pty-manager'

// File logger for debugging startup issues
const logPath = join(app.getPath('userData'), 'cmdcld.log')
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(logPath, line) } catch {}
}

log('=== App starting ===')

// Hydrate PATH and env from the user's login shell when launched from Finder/Dock.
// Packaged macOS apps start with a bare environment (PATH ≈ /usr/bin:/bin:/usr/sbin:/sbin),
// which breaks MCP servers that Claude Code spawns via `npx`, `uvx`, Homebrew `node`, nvm, etc.
// Running the login shell interactively picks up ~/.zshrc / ~/.zprofile / ~/.bash_profile
// so PTYs inherit the same environment the user sees in their terminal.
function hydrateLoginShellEnv(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execSync(`${shell} -ilc 'printf "%s\\0" "$PATH"; env -0'`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const firstNul = out.indexOf('\0')
    const loginPath = firstNul >= 0 ? out.slice(0, firstNul) : ''
    const envBlob = firstNul >= 0 ? out.slice(firstNul + 1) : ''
    if (loginPath) process.env.PATH = loginPath
    for (const entry of envBlob.split('\0')) {
      const eq = entry.indexOf('=')
      if (eq <= 0) continue
      const k = entry.slice(0, eq)
      const v = entry.slice(eq + 1)
      if (k === 'PATH') continue // already set above
      if (process.env[k] == null) process.env[k] = v
    }
    log(`Login shell env hydrated (PATH=${process.env.PATH})`)
  } catch (e) {
    log(`Login shell env hydration FAILED: ${e}`)
  }
}

if (app.isPackaged) {
  hydrateLoginShellEnv()
}

// Single instance lock — only one app process at a time
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log('Single instance lock failed — another instance is running. Exiting.')
  app.exit(0)
}

log('Single instance lock acquired')

let ptyManager: PtyManager
let store: Store
let recentDB: RecentDB
let settings: Settings
const registry = new WindowRegistry()
let remoteServer: RemoteServer
const newWindowIds = new Set<string>()

try {
  ptyManager = new PtyManager()
  store = new Store(join(app.getPath('userData'), 'sessions.json'))
  recentDB = new RecentDB(join(app.getPath('userData'), 'recent.db'))
  settings = new Settings(join(app.getPath('userData'), 'settings.json'))
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

  // Auto-detect editors and set default if not configured
  const availableEditors = detectEditors()
  log(`Detected editors: ${availableEditors.map(e => e.name).join(', ') || 'none'}`)
  const currentEditor = settings.get('editor')
  if (!availableEditors.find(e => e.cmd === currentEditor)) {
    const def = getDefaultEditor(availableEditors)
    if (def) settings.set('editor', def.cmd)
  }
  log('All services created')
} catch (e) {
  log(`Service init FAILED: ${e}`)
  throw e
}

// Previously enforced bypass-permissions lockdown; now a no-op.
// Folder trust is still handled per-folder via `trustFolder` in pty:create.
try {
  hardenGlobalSettings()
} catch (e) {
  log(`hardenGlobalSettings failed: ${e}`)
}

function createWindow(opts?: { empty?: boolean; persistedId?: string }): { id: string; window: BrowserWindow } {
  const id = opts?.persistedId || crypto.randomUUID()
  const bounds = store.getWindowBounds(id)
  const isEmpty = opts?.empty ?? false

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 400,
    minHeight: 300,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    backgroundColor: '#1e1e1e',
    title: 'CmdCLD',
  })

  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
  }

  // Open external URLs in the system browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (isEmpty) url.searchParams.set('empty', '1')
    win.loadURL(url.toString())
  } else {
    const filePath = join(__dirname, '../renderer/index.html')
    if (isEmpty) {
      win.loadFile(filePath, { query: { empty: '1' } })
    } else {
      win.loadFile(filePath)
    }
  }

  registry.register(id, win)
  broadcastWindowList()

  // Debounced bounds save — avoids sync I/O on every pixel during drag/resize
  let boundsTimer: ReturnType<typeof setTimeout>
  const saveBounds = (): void => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        store.saveWindowBounds(id, win.getBounds())
      }
    }, 500)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  win.on('close', () => {
    clearTimeout(boundsTimer)
    // Save final bounds
    if (!win.isDestroyed()) {
      store.saveWindowBounds(id, win.getBounds())
    }
    const owned = ptyManager.listByWebContents(win.webContents)
    for (const meta of owned) {
      ptyManager.kill(meta.id)
    }
    registry.unregister(id)
  })

  win.on('closed', () => {
    broadcastWindowList()
    // On non-macOS, quit when last window closes
    if (process.platform !== 'darwin' && registry.size() === 0) {
      app.quit()
    }
  })

  return { id, window: win }
}

function broadcastWindowList(): void {
  const list = registry.list()
  registry.broadcastAll('window:list-updated', list)
}

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
  // Validate cwd is a real directory
  try {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return
  } catch { return }
  // Prevent overwriting existing PTY
  if (ptyManager.getMeta(id)) return
  const name = cwd.split(/[\\/]/).pop() || cwd
  const meta: TerminalMeta = { id, path: cwd, name, color: '' }
  trustFolder(cwd)
  ptyManager.create(id, cwd, wc, meta)
})

ipcMain.handle('pty:write', (_event, id: string, data: string) => {
  ptyManager.write(id, data)
})

ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows)
})

ipcMain.handle('pty:scrollback', (_event, id: string) => {
  return ptyManager.getScrollback(id)
})

ipcMain.handle('pty:kill', (_event, id: string) => {
  ptyManager.kill(id)
})

// Window management
ipcMain.handle('window:create', () => {
  const { id } = createWindow({ empty: true })
  return id
})

ipcMain.handle('window:list', (event) => {
  const callerId = getWindowIdFromEvent(event)
  if (!callerId) return []
  return registry.listExcluding(callerId)
})

// Open URL in system browser
ipcMain.handle('shell:openExternal', (_event, url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url)
  }
})

// Open folder in file manager (cross-platform)
ipcMain.handle('explorer:open', (_event, folderPath: string) => {
  try {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) return
  } catch { return }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const child = spawn(cmd, [folderPath], { detached: true, stdio: 'ignore' })
  child.unref()
})

// Open in editor — uses configured editor
// shell:true is needed on Windows because editors like 'code' are .cmd batch wrappers
// On macOS/Linux they're symlinks that work directly
// Accepts both file paths (from clickable links) and directory paths
ipcMain.handle('editor:open', (_event, targetPath: string) => {
  const cmd = settings.get('editor')
  try {
    if (!existsSync(targetPath)) return
  } catch { return }
  const child = spawn(cmd, [targetPath], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' })
  child.unref()
})

// Editor settings
ipcMain.handle('editor:getAvailable', () => {
  return detectEditors()
})

ipcMain.handle('editor:getCurrent', () => {
  return settings.get('editor')
})

ipcMain.handle('editor:setCurrent', (_event, cmd: string) => {
  settings.set('editor', cmd)
})

// Clipboard image paste — saves to .screenshots/ inside the project folder
ipcMain.handle('clipboard:saveImage', (_event, cwd: string) => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  const screenshotsDir = join(cwd, '.screenshots')
  mkdirSync(screenshotsDir, { recursive: true })
  const now = new Date()
  const ts = now.toISOString().replace(/[T:]/g, '-').replace(/\..+/, '').replace(/-/g, (m, i) => i < 10 ? '-' : i === 10 ? '_' : '')
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}m${String(now.getSeconds()).padStart(2,'0')}s`
  const filePath = join(screenshotsDir, `screenshot-${stamp}.png`)
  writeFileSync(filePath, img.toPNG())
  return filePath
})

// Read file paths from clipboard (for Ctrl+V file-paste)
function readClipboardFilePaths(): string[] | null {
  try {
    if (process.platform === 'win32') {
      // CF_HDROP via FileNameW — UTF-16LE, null-terminated, returns first file
      const buf = clipboard.readBuffer('FileNameW')
      if (!buf || buf.length < 2) return null
      const raw = buf.toString('utf16le')
      const trimmed = raw.replace(/\0+$/, '')
      if (!trimmed) return null
      return [trimmed]
    } else if (process.platform === 'darwin') {
      // public.file-url — single file:// URL
      const raw = clipboard.read('public.file-url')
      if (!raw) return null
      const p = raw.startsWith('file://') ? fileURLToPath(raw) : raw
      if (!p) return null
      return [p]
    } else {
      // Linux: text/uri-list — newline-separated file:// URLs
      const raw = clipboard.read('text/uri-list')
      if (!raw) return null
      const paths = raw
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.startsWith('file://') ? fileURLToPath(line) : line)
        .filter(Boolean)
      return paths.length > 0 ? paths : null
    }
  } catch {
    return null
  }
}

ipcMain.handle('clipboard:readFiles', () => readClipboardFilePaths())

// Settings
ipcMain.handle('settings:getAll', () => {
  return settings.getAll()
})

ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  settings.set(key as any, value as any)
})

// Claude CLI config (global + local settings files)
ipcMain.handle('claude-config:read', () => readClaudeConfig())

ipcMain.handle('claude-config:write', (_event, scope: 'global' | 'local', data: Record<string, unknown>) => {
  writeClaudeConfig(scope, data)
})

// Keep the app process from being suspended while remote access is on, so a
// headless Mac (mini) stays reachable over Tailscale. Does NOT prevent system
// sleep — the user is expected to set `pmset sleep 0` at the OS level.
let sleepBlockerId: number | null = null
function setSleepBlockEnabled(enabled: boolean): void {
  if (enabled && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    log(`Sleep blocker started (id=${sleepBlockerId})`)
  } else if (!enabled && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId)
    log(`Sleep blocker stopped (id=${sleepBlockerId})`)
    sleepBlockerId = null
  }
}

// Remote access
ipcMain.handle('remote:toggle', async (_event, enabled: boolean) => {
  if (enabled) {
    const port = settings.get('remotePort')
    try {
      const result = await remoteServer.start(port)
      setSleepBlockEnabled(true)
      return { ok: true, urls: result.urls, port: result.port }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Failed to start server' }
    }
  } else {
    remoteServer.stop()
    setSleepBlockEnabled(false)
    return { ok: true }
  }
})

ipcMain.handle('remote:status', () => {
  const port = settings.get('remotePort') as number
  const running = remoteServer.isRunning()
  return {
    running,
    port,
    urls: running ? remoteServer.getUrls(port) : [],
  }
})

// Tailscale HTTPS exposure — shells out to the user's tailscale CLI.
// Requires: tailscale installed, signed in, and HTTPS enabled on the tailnet.
ipcMain.handle('tailscale:status', async () => {
  const status = await tsGetStatus()
  const serve = status.installed ? await tsGetServeStatus() : { active: false, url: null as string | null }
  return { ...status, serveActive: serve.active, serveUrl: serve.url }
})

ipcMain.handle('tailscale:serveStart', async () => {
  if (!remoteServer.isRunning()) {
    return { ok: false, error: 'Enable Remote Access first.' }
  }
  const port = settings.get('remotePort') as number
  return tsStartServe(port)
})

ipcMain.handle('tailscale:serveStop', async () => {
  return tsStopServe()
})

// Get home directory for quick Claude sessions
ipcMain.handle('app:getHomeDir', () => {
  return app.getPath('home')
})

// Get app version
ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

// Read file contents (for markdown viewer)
ipcMain.handle('file:read', (_event, filePath: string) => {
  try {
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) return null
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})

// Create new project folder
ipcMain.handle('project:create', (_event, folderName: string) => {
  const root = settings.get('projectsRoot')
  if (!root) return null
  const fullPath = join(root, folderName)
  try {
    if (existsSync(fullPath)) return null // already exists
    mkdirSync(fullPath, { recursive: true })
    return fullPath
  } catch {
    return null
  }
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

// Recent folders
ipcMain.handle('recent:list', async () => {
  return recentDB.list()
})

ipcMain.handle('recent:add', async (_event, folderPath: string) => {
  await recentDB.add(folderPath)
})

ipcMain.handle('recent-check-path', (_e, p: string) => recentDB.checkPath(p))

ipcMain.handle('get-build-info', () => ({
  electron: process.versions.electron,
  chrome:   process.versions.chrome,
  node:     process.versions.node,
  platform: process.platform,
  release:  os.release(),
}))

// Store IPC handlers
ipcMain.handle('store:load', () => {
  return store.load()
})

ipcMain.handle('store:save', (_event, state) => {
  // Basic validation before saving
  if (state && typeof state === 'object' && Array.isArray(state.windows)) {
    store.save(state)
  }
})

app.whenReady().then(() => {
  log('App ready — creating first window')

  // macOS application menu with standard shortcuts (Cmd+Q, Cmd+W, Edit menu)
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' },
        ],
      },
    ]))
  }

  try {
    createWindow({ persistedId: 'primary' })
    log('First window created successfully')

    // Auto-start remote server if enabled
    if (settings.get('remoteAccess')) {
      const port = settings.get('remotePort')
      remoteServer.start(port).then((result) => {
        log(`Remote server started on port ${result.port}: ${result.urls.join(', ')}`)
        setSleepBlockEnabled(true)
      }).catch((err) => {
        log(`Remote server failed to start: ${err.message}`)
      })
    }
  } catch (e) {
    log(`createWindow FAILED: ${e}`)
  }
})

app.on('second-instance', () => {
  const list = registry.list()
  if (list.length > 0) {
    const win = registry.get(list[0].id)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }
})

app.on('window-all-closed', () => {
  // macOS: keep app running in dock when all windows close
  if (process.platform === 'darwin') {
    log('All windows closed — staying in dock (macOS)')
    return
  }
  log('All windows closed — quitting')
  app.quit()
})

// Cleanup resources when app is quitting (works on all platforms including macOS Cmd+Q)
app.on('before-quit', () => {
  log('App quitting — cleaning up')
  ptyManager.killAll()
  remoteServer.stop()
  recentDB.close()
})

// macOS: re-create window when clicking dock icon with no windows open
app.on('activate', () => {
  if (registry.size() === 0) {
    log('Dock click — creating new window (macOS)')
    createWindow({ persistedId: 'primary' })
  }
})

process.on('uncaughtException', (e) => {
  log(`UNCAUGHT EXCEPTION: ${e.stack || e}`)
})

process.on('unhandledRejection', (e) => {
  log(`UNHANDLED REJECTION: ${e}`)
})
