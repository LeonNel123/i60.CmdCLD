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
