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

export interface SavedProject {
  path: string
  agentCli?: 'claude' | 'codex'
  claudeArgs: string
  codexArgs?: string
  isPlainShell: boolean
}

export interface SavedSession {
  savedAt: number
  projects: SavedProject[]
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  dirty: boolean
}

export interface ElectronAPI {
  platform: 'win32' | 'darwin' | 'linux'
  createTerminal: (id: string, cwd: string, agentCli?: 'claude' | 'codex', launchArgs?: string) => Promise<void>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  getScrollback: (id: string) => Promise<string>
  onTerminalData: (id: string, callback: (data: string) => void) => () => void
  onTerminalExit: (id: string, callback: (exitCode: number) => void) => () => void
  onTerminalResize: (id: string, callback: (size: { cols: number; rows: number }) => void) => () => void
  selectFolder: () => Promise<string | null>
  loadState: () => Promise<MultiWindowState | null>
  saveState: (state: MultiWindowState) => Promise<void>
  windowCreate: () => Promise<string>
  windowList: () => Promise<WindowInfo[]>
  recentList: () => Promise<RecentFolder[]>
  recentAdd: (folderPath: string) => Promise<void>
  recentCheckPath: (path: string) => Promise<'ok' | 'missing' | 'unmounted'>
  getBuildInfo: () => Promise<{
    electron: string
    chrome: string
    node: string
    platform: string
    release: string
  }>
  readFile: (filePath: string) => Promise<string | null>
  clipboardSaveImage: (cwd: string) => Promise<string | null>
  clipboardReadFiles: () => Promise<string[] | null>
  getHomeDir: () => Promise<string>
  getVersion: () => Promise<string>
  projectCreate: (folderName: string) => Promise<string | null>
  settingsGetAll: () => Promise<{ editor: string; defaultAgentCli: 'claude' | 'codex'; claudeArgs: string; codexArgs: string; askBeforeLaunch: boolean; defaultViewMode: 'grid' | 'focused'; notifyOnIdle: boolean; projectsRoot: string; remoteAccess: boolean; remotePort: number; favoriteFolders: string[]; restoreSessionEnabled: boolean; autopilotApiProvider: 'anthropic' | 'openrouter'; autopilotPlannerModel: string; autopilotDefaultCostCap: number; autopilotDefaultMaxIterations: number }>
  settingsSet: (key: string, value: unknown) => Promise<void>
  agentCliAvailability: () => Promise<Record<'claude' | 'codex', { available: boolean; path: string | null }>>
  settingsGetBudgetState: (projectPath: string) => Promise<{
    state: { date: string; perProject: Record<string, { spentUsd: number; capUsd: number }>; global: { spentUsd: number; capUsd: number } }
    snapshot: { date: string; projectSpent: number; projectCap: number; globalSpent: number; globalCap: number; capReached: boolean; capReachedReason: 'project' | 'global' | null; warningThreshold: boolean }
  }>
  settingsSetBudgetCap: (scope: 'project' | 'global', projectPath: string | null, capUsd: number) => Promise<{ ok: boolean; error?: string }>
  settingsResetTodaySpend: () => Promise<{ ok: boolean }>
  sessionSaveLast: (session: SavedSession) => Promise<void>
  sessionLoadLast: () => Promise<SavedSession | null>
  sessionClearLast: () => Promise<void>
  gitStatus: (path: string) => Promise<GitStatus>
  openExternal: (url: string) => Promise<void>
  openInExplorer: (folderPath: string) => Promise<void>
  openInEditor: (targetPath: string) => Promise<void>
  editorGetAvailable: () => Promise<Array<{ id: string; name: string; cmd: string }>>
  editorGetCurrent: () => Promise<string>
  editorSetCurrent: (cmd: string) => Promise<void>
  onWindowListUpdated: (callback: (windows: WindowInfo[]) => void) => () => void
  claudeConfigRead: () => Promise<{ global: Record<string, unknown>; local: Record<string, unknown> }>
  claudeConfigWrite: (scope: 'global' | 'local', data: Record<string, unknown>) => Promise<void>
  remoteToggle: (enabled: boolean) => Promise<{ ok: boolean; urls?: string[]; port?: number; error?: string }>
  remoteStatus: () => Promise<{ running: boolean; port: number; urls?: string[] }>
  tailscaleStatus: () => Promise<{
    installed: boolean
    loggedIn: boolean
    online: boolean
    httpsEnabled: boolean
    httpsHost: string | null
    error: string | null
    serveActive: boolean
    serveUrl: string | null
  }>
  tailscaleServeStart: () => Promise<{ ok: boolean; url?: string; error?: string }>
  tailscaleServeStop: () => Promise<{ ok: boolean; error?: string }>
  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string; codexArgs?: string; agentCli?: 'claude' | 'codex' }) => void) => () => void
  autopilotKeyExists: (provider: 'anthropic' | 'openrouter') => Promise<boolean>
  autopilotKeySet: (provider: 'anthropic' | 'openrouter', key: string) => Promise<void>
  autopilotKeyClear: (provider: 'anthropic' | 'openrouter') => Promise<void>
  autopilotStart: (args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number; maxIterations: number }) => Promise<{ ok: boolean; error?: string }>
  autopilotProStart: (args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number }) => Promise<{ ok: boolean; error?: string }>
  autopilotProRunMeta: (terminalId: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>
  autopilotPause: (terminalId: string) => Promise<void>
  autopilotResume: (terminalId: string) => Promise<void>
  autopilotStop: (terminalId: string) => Promise<void>
  autopilotApproveGoal: (terminalId: string) => Promise<void>
  autopilotReplyToWaiting: (terminalId: string, text: string) => Promise<void>
  autopilotPermissionAllow: (terminalId: string) => Promise<void>
  autopilotPermissionDeny: (terminalId: string) => Promise<void>
  autopilotGetStatus: (terminalId: string) => Promise<unknown>
  autopilotInspectOutput: (terminalId: string) => Promise<unknown>
  autopilotProbeArtifacts: (projectPath: string) => Promise<{ hasClassic: boolean; hasPro: boolean }>
  autopilotAttachDraft: (args: {
    terminalId: string
    userAnswer?: string
    useLlm: boolean
  }) => Promise<{
    ok: boolean
    draft?: unknown
    error?: string
  }>
  autopilotAttachConfirm: (args: {
    terminalId: string
    bridgePrompt: string
  }) => Promise<{
    ok: boolean
    status?: unknown
    error?: string
  }>
  autopilotAttachStatus: (terminalId: string) => Promise<unknown>
  autopilotAttachCancel: (terminalId: string) => Promise<{ ok: boolean }>
  onAutopilotUpdate: (callback: (terminalId: string, state: unknown) => void) => () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
