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
