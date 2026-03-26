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

  // Window management
  windowCreate: (): Promise<string> =>
    ipcRenderer.invoke('window:create'),

  windowList: (): Promise<Array<{ id: string; label: string }>> =>
    ipcRenderer.invoke('window:list'),

  // VS Code
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
