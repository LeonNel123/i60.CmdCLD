import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Platform info (synchronous — available immediately)
  platform: process.platform as 'win32' | 'darwin' | 'linux',

  // Existing PTY methods
  createTerminal: (id: string, cwd: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd),

  writeTerminal: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('pty:write', id, data),

  resizeTerminal: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),

  killTerminal: (id: string): Promise<void> =>
    ipcRenderer.invoke('pty:kill', id),

  getScrollback: (id: string): Promise<string> =>
    ipcRenderer.invoke('pty:scrollback', id),

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

  // Fires when the PTY size changes from any source (including remote web
  // clients). Renderer should call term.resize(cols, rows) to stay in sync
  // with the authoritative PTY dims — do NOT call fitAddon.fit() here, since
  // that would feed back and kick the active client off the size.
  onTerminalResize: (id: string, callback: (size: { cols: number; rows: number }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, size: { cols: number; rows: number }): void => callback(size)
    ipcRenderer.on(`pty:resize:${id}`, listener)
    return () => { ipcRenderer.removeListener(`pty:resize:${id}`, listener) }
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

  // Clipboard file references — returns array of absolute paths, or null
  clipboardReadFiles: (): Promise<string[] | null> =>
    ipcRenderer.invoke('clipboard:readFiles'),

  // File reading (for markdown viewer)
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('file:read', filePath),

  // App info
  getHomeDir: (): Promise<string> =>
    ipcRenderer.invoke('app:getHomeDir'),

  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:getVersion'),

  // Settings
  projectCreate: (folderName: string): Promise<string | null> =>
    ipcRenderer.invoke('project:create', folderName),

  settingsGetAll: (): Promise<{ editor: string; claudeArgs: string; askBeforeLaunch: boolean; defaultViewMode: 'grid' | 'focused'; notifyOnIdle: boolean; projectsRoot: string; remoteAccess: boolean; remotePort: number; favoriteFolders: string[] }> =>
    ipcRenderer.invoke('settings:getAll'),

  settingsSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  // Window management
  windowCreate: (): Promise<string> =>
    ipcRenderer.invoke('window:create'),

  windowList: (): Promise<Array<{ id: string; label: string }>> =>
    ipcRenderer.invoke('window:list'),

  // Open URL in system browser
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),

  // Explorer
  openInExplorer: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('explorer:open', folderPath),

  // Editor (accepts files or directories)
  openInEditor: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('editor:open', targetPath),

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

  // Recent path check (prunes if missing)
  recentCheckPath: (path: string): Promise<'ok' | 'missing' | 'unmounted'> =>
    ipcRenderer.invoke('recent-check-path', path),

  // Claude CLI config (global + local settings.json)
  claudeConfigRead: (): Promise<{ global: Record<string, unknown>; local: Record<string, unknown> }> =>
    ipcRenderer.invoke('claude-config:read'),

  claudeConfigWrite: (scope: 'global' | 'local', data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('claude-config:write', scope, data),

  // Last-session store
  sessionSaveLast: (session: { savedAt: number; projects: Array<{ path: string; claudeArgs: string; isPlainShell: boolean }> }): Promise<void> =>
    ipcRenderer.invoke('session:saveLast', session),

  sessionLoadLast: (): Promise<{ savedAt: number; projects: Array<{ path: string; claudeArgs: string; isPlainShell: boolean }> } | null> =>
    ipcRenderer.invoke('session:loadLast'),

  sessionClearLast: (): Promise<void> =>
    ipcRenderer.invoke('session:clearLast'),

  // Git status (cached, 30s TTL)
  gitStatus: (path: string): Promise<{ isRepo: boolean; branch: string | null; dirty: boolean }> =>
    ipcRenderer.invoke('git:status', path),

  // Build info for About tab
  getBuildInfo: (): Promise<{ electron: string; chrome: string; node: string; platform: string; release: string }> =>
    ipcRenderer.invoke('get-build-info'),

  // Remote access
  remoteToggle: (enabled: boolean): Promise<{ ok: boolean; urls?: string[]; port?: number; error?: string }> =>
    ipcRenderer.invoke('remote:toggle', enabled),

  remoteStatus: (): Promise<{ running: boolean; port: number }> =>
    ipcRenderer.invoke('remote:status'),

  // Tailscale HTTPS exposure
  tailscaleStatus: (): Promise<{
    installed: boolean
    loggedIn: boolean
    online: boolean
    httpsEnabled: boolean
    httpsHost: string | null
    error: string | null
    serveActive: boolean
    serveUrl: string | null
  }> => ipcRenderer.invoke('tailscale:status'),

  tailscaleServeStart: (): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('tailscale:serveStart'),

  tailscaleServeStop: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('tailscale:serveStop'),

  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, session: any): void => callback(session)
    ipcRenderer.on('remote:session-created', listener)
    return () => { ipcRenderer.removeListener('remote:session-created', listener) }
  },
})
