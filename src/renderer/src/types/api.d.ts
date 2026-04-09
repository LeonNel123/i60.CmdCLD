export interface WindowInfo {
  id: string
  label: string
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

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

export interface ElectronAPI {
  platform: 'win32' | 'darwin' | 'linux'
  createTerminal: (id: string, cwd: string) => Promise<void>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  getScrollback: (id: string) => Promise<string>
  onTerminalData: (id: string, callback: (data: string) => void) => () => void
  onTerminalExit: (id: string, callback: (exitCode: number) => void) => () => void
  selectFolder: () => Promise<string | null>
  loadState: () => Promise<MultiWindowState | null>
  saveState: (state: MultiWindowState) => Promise<void>
  windowCreate: () => Promise<string>
  windowList: () => Promise<WindowInfo[]>
  recentList: () => Promise<RecentFolder[]>
  recentAdd: (folderPath: string) => Promise<void>
  readFile: (filePath: string) => Promise<string | null>
  clipboardSaveImage: (cwd: string) => Promise<string | null>
  getHomeDir: () => Promise<string>
  getVersion: () => Promise<string>
  projectCreate: (folderName: string) => Promise<string | null>
  settingsGetAll: () => Promise<{ editor: string; claudeArgs: string; askBeforeLaunch: boolean; defaultViewMode: 'grid' | 'focused'; notifyOnIdle: boolean; projectsRoot: string; remoteAccess: boolean; remotePort: number; favoriteFolders: string[] }>
  settingsSet: (key: string, value: unknown) => Promise<void>
  openExternal: (url: string) => Promise<void>
  openInExplorer: (folderPath: string) => Promise<void>
  openInEditor: (targetPath: string) => Promise<void>
  editorGetAvailable: () => Promise<Array<{ id: string; name: string; cmd: string }>>
  editorGetCurrent: () => Promise<string>
  editorSetCurrent: (cmd: string) => Promise<void>
  onWindowListUpdated: (callback: (windows: WindowInfo[]) => void) => () => void
  remoteToggle: (enabled: boolean) => Promise<{ ok: boolean; urls?: string[]; port?: number; error?: string }>
  remoteStatus: () => Promise<{ running: boolean; port: number; urls?: string[] }>
  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string }) => void) => () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
