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
  shouldLoadState: () => Promise<boolean>
  windowCreate: () => Promise<string>
  windowList: () => Promise<WindowInfo[]>
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
