import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { appendFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { PtyManager } from './pty-manager'
import { Store } from './store'
import { WindowRegistry } from './window-registry'
import { RecentDB } from './recent-db'
import { Settings } from './settings'
import { detectEditors, getDefaultEditor } from './editor-detect'
import type { TerminalMeta } from './pty-manager'

// File logger for debugging startup issues
const logPath = join(app.getPath('userData'), 'cmdcld.log')
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(logPath, line) } catch {}
}

log('=== App starting ===')

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
const newWindowIds = new Set<string>()

try {
  ptyManager = new PtyManager()
  store = new Store(join(app.getPath('userData'), 'sessions.json'))
  recentDB = new RecentDB(join(app.getPath('userData'), 'recent.db'))
  settings = new Settings(join(app.getPath('userData'), 'settings.json'))

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

function createWindow(opts?: { empty?: boolean }): { id: string; window: BrowserWindow } {
  const id = crypto.randomUUID()
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
    backgroundColor: '#0a0a1a',
    title: 'CmdCLD',
  })

  win.setMenuBarVisibility(false)

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
  const { id } = createWindow({ empty: true })
  return id
})

ipcMain.handle('window:list', (event) => {
  const callerId = getWindowIdFromEvent(event)
  if (!callerId) return []
  return registry.listExcluding(callerId)
})

// Open in editor — uses configured editor
// spawn with shell:true is needed because editors like 'code' are .cmd batch files on Windows
// folderPath is validated as a directory before use, cmd comes from settings
ipcMain.handle('editor:open', (_event, folderPath: string) => {
  const cmd = settings.get('editor')
  try {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) return
  } catch { return }
  const child = spawn(cmd, [folderPath], { shell: true, detached: true, stdio: 'ignore' })
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

// Settings
ipcMain.handle('settings:getAll', () => {
  return settings.getAll()
})

ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  settings.set(key as any, value as any)
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
  try {
    createWindow()
    log('First window created successfully')
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
  log('All windows closed — quitting')
  ptyManager.killAll()
  recentDB.close()
  app.quit()
})

process.on('uncaughtException', (e) => {
  log(`UNCAUGHT EXCEPTION: ${e.stack || e}`)
})

process.on('unhandledRejection', (e) => {
  log(`UNHANDLED REJECTION: ${e}`)
})
