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

  // Recent folders
  recentList: (): Promise<Array<{ path: string; name: string; lastOpened: number }>> =>
    ipcRenderer.invoke('recent:list'),

  recentAdd: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('recent:add', folderPath),

  // Clipboard image — saves to .screenshots/ in project folder, returns path
  clipboardSaveImage: (cwd: string): Promise<string | null> =>
    ipcRenderer.invoke('clipboard:saveImage', cwd),

  // Settings
  settingsGetAll: (): Promise<{ editor: string; claudeArgs: string; askBeforeLaunch: boolean; defaultViewMode: 'grid' | 'focused' }> =>
    ipcRenderer.invoke('settings:getAll'),

  settingsSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  // Window management
  windowCreate: (): Promise<string> =>
    ipcRenderer.invoke('window:create'),

  windowList: (): Promise<Array<{ id: string; label: string }>> =>
    ipcRenderer.invoke('window:list'),

  // Explorer
  openInExplorer: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('explorer:open', folderPath),

  // Editor
  openInEditor: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('editor:open', folderPath),

  editorGetAvailable: (): Promise<Array<{ id: string; name: string; cmd: string }>> =>
    ipcRenderer.invoke('editor:getAvailable'),

  editorGetCurrent: (): Promise<string> =>
    ipcRenderer.invoke('editor:getCurrent'),

  editorSetCurrent: (cmd: string): Promise<void> =>
    ipcRenderer.invoke('editor:setCurrent', cmd),

  onWindowListUpdated: (callback: (windows: Array<{ id: string; label: string }>) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, windows: any): void => callback(windows)
    ipcRenderer.on('window:list-updated', listener)
    return () => { ipcRenderer.removeListener('window:list-updated', listener) }
  },
})
