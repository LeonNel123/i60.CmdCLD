export interface SessionState {
  folders: Array<{
    path: string
    color: string
    layout: { x: number; y: number; w: number; h: number }
  }>
  windowBounds: { width: number; height: number; x: number; y: number }
}

export interface ElectronAPI {
  createTerminal: (id: string, cwd: string) => Promise<void>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  onTerminalData: (id: string, callback: (data: string) => void) => () => void
  onTerminalExit: (id: string, callback: (exitCode: number) => void) => () => void
  selectFolder: () => Promise<string | null>
  loadState: () => Promise<SessionState | null>
  saveState: (state: SessionState) => Promise<void>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
