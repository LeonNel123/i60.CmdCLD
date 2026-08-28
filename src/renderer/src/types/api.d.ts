/** One entry of the live OpenRouter catalogue; prices are USD per 1M tokens. */
export interface OpenRouterCatalogueModel {
  id: string
  name: string
  contextLength: number
  supportsTools: boolean
  rate: { input: number; cachedInput: number; cacheCreation: number; output: number }
}

export interface OpenRouterCatalogue {
  /** Epoch ms of the last successful fetch; 0 means seed data only. */
  fetchedAt: number
  models: OpenRouterCatalogueModel[]
}

export interface AiUsageSite {
  id: string
  label: string
  what: string
  model: string
  provider: 'anthropic' | 'openrouter'
  setting: string
}

export interface AiUsageSummary {
  sites: AiUsageSite[]
  keys: { anthropic: boolean; openrouter: boolean }
  refine: { count: number; byModel: Record<string, number>; avgMs: number | null }
  broadcastsLogged: number
}
export interface PromptRecord {
  id: number
  sentAt: number
  targets: string[]
  projects: string[]
  originalText: string
  refinedText: string | null
  model: string | null
  refineMs: number | null
  ok: boolean
}
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
  agentCli?: 'claude' | 'codex' | 'grok' | 'opencode'
  claudeArgs: string
  codexArgs?: string
  grokArgs?: string
  opencodeArgs?: string
  isPlainShell: boolean
  // Tucked into the taskbar when the session was saved; restored the same way.
  minimized?: boolean
}

export interface SavedSession {
  savedAt: number
  projects: SavedProject[]
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  dirty: boolean
  ahead: number
}

export type ApiProvider = 'anthropic' | 'openrouter'

export type ApiUsage = {
  inputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
}

export type AttachClassification =
  | 'idle'
  | 'waiting_for_user'
  | 'permission_request'
  | 'working'
  | 'blocked'
  | 'unknown'

export type MarkerKind = 'WAITING' | 'PROGRESS' | 'GOAL_READY' | 'STUCK'

export type CouncilIntensity = 'light' | 'balanced' | 'strict'

export interface CouncilState {
  mode: 'council'
  stage: string
  control: 'idle' | 'running' | 'paused' | 'blocked' | 'stopped'
  implementerCli: 'claude' | 'codex' | 'grok' | 'opencode'
  reviewerCli: 'claude' | 'codex' | 'grok' | 'opencode'
  intensity: CouncilIntensity
  cycleCount: number
  costUsd: number
  costCapUsd: number
  liveStatus: string | null
  escalationReason: string | null
  reviewerStatus: string
  reviewerWarning: string | null
  lastReviewPacketId: string | null
  lastCouncilDecision: {
    action: string
    gate: string
    risk: string
    instruction: string
    reason: string
    reviewerVerdict: string
  } | null
}

export interface AttachDraft {
  terminalId: string
  classification: AttachClassification
  bridgePrompt: string
  cleanTail: string
  usedLlm: boolean
  provider: ApiProvider
  model: string
  usage?: ApiUsage
  estimatedCostUsd?: number
  error?: string
}

export interface AttachSessionStatus {
  id: string
  terminalId: string
  status:
    | 'drafting'
    | 'drafted'
    | 'sending_bridge'
    | 'watching'
    | 'attached'
    | 'no_marker_yet'
    | 'failed'
    | 'cancelled'
  baselineOffset: number
  bridgeSentAt: number | null
  lastMarker: { kind: MarkerKind; receivedAt: number; text?: string; raw?: string } | null
  lastError: string | null
  message: string
}

export interface ElectronAPI {
  platform: 'win32' | 'darwin' | 'linux'
  /** Absolute path of a dropped File (Electron's webUtils; File.path is gone). */
  getPathForFile: (file: File) => string
  createTerminal: (id: string, cwd: string, agentCli?: 'claude' | 'codex' | 'grok' | 'opencode', launchArgs?: string, elevated?: boolean) => Promise<void>
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
  recentRemove: (folderPath: string) => Promise<void>
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
  clipboardWriteText: (text: string) => Promise<void>
  openPath: (target: string) => Promise<{ ok: boolean; error?: string }>
  adminShellMode: () => Promise<'in-app' | 'external'>
  openAdminShell: () => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>
  getHomeDir: () => Promise<string>
  getVersion: () => Promise<string>
  projectCreate: (folderName: string) => Promise<string | null>
  openrouterModels: (refresh?: boolean) => Promise<OpenRouterCatalogue>
  settingsGetAll: () => Promise<{ editor: string; defaultAgentCli: 'claude' | 'codex' | 'grok' | 'opencode'; claudeArgs: string; codexArgs: string; grokArgs: string; opencodeArgs: string; askBeforeLaunch: boolean; defaultViewMode: 'grid' | 'focused'; notifyOnIdle: boolean; projectsRoot: string; remoteAccess: boolean; remotePort: number; remoteLanAccess: boolean; favoriteFolders: string[]; restoreSessionEnabled: boolean; restoreSessionResume: boolean; terminalFontFamily: string; terminalFontSize: number; appFontFamily: string; uiScalePct: number; autopilotApiProvider: 'anthropic' | 'openrouter'; autopilotPlannerModel: string; broadcastRefineModel: string; broadcastAutoRefine: boolean; broadcastRefineSystemPrompt: string; autopilotDefaultCostCap: number; autopilotDefaultMaxIterations: number }>
  settingsSet: (key: string, value: unknown) => Promise<void>
  agentCliAvailability: () => Promise<Record<'claude' | 'codex' | 'grok' | 'opencode', { available: boolean; path: string | null }>>
  settingsGetBudgetState: (projectPath: string) => Promise<{
    state: { date: string; perProject: Record<string, { spentUsd: number; capUsd: number }>; global: { spentUsd: number; capUsd: number } }
    snapshot: { date: string; projectSpent: number; projectCap: number; globalSpent: number; globalCap: number; capReached: boolean; capReachedReason: 'project' | 'global' | null; warningThreshold: boolean }
  }>
  settingsSetBudgetCap: (scope: 'project' | 'global', projectPath: string | null, capUsd: number) => Promise<{ ok: boolean; error?: string }>
  settingsResetTodaySpend: () => Promise<{ ok: boolean }>
  sessionSaveLast: (session: SavedSession) => Promise<void>
  sessionLoadLast: () => Promise<SavedSession | null>
  sessionClearLast: () => Promise<void>
  gitStatus: (path: string, fresh?: boolean) => Promise<GitStatus>
  openExternal: (url: string, source?: string) => Promise<void>
  openInExplorer: (folderPath: string) => Promise<void>
  openInEditor: (
    targetPath: string,
    opts?: { forceFolder?: boolean; editorId?: string; projectPath?: string },
  ) => Promise<{ ok: boolean; error?: string; opened?: 'solution' | 'editor'; name?: string }>
  editorProbeProject: (folderPath: string) => Promise<{ path: string; name: string; kind: 'solution' | 'project' } | null>
  editorGetAvailable: () => Promise<Array<{ id: string; name: string; cmd: string }>>
  editorGetDefaults: (projectPath?: string) => Promise<{ global: string; project: string; resolvedId: string | null }>
  editorSetDefault: (arg: { scope: 'global' | 'project'; editorId: string | null; projectPath?: string }) => Promise<{ ok: boolean }>
  onWindowListUpdated: (callback: (windows: WindowInfo[]) => void) => () => void
  onWindowCloseRequest: (callback: () => void) => () => void
  windowConfirmClose: () => Promise<void>
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
  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string; codexArgs?: string; grokArgs?: string; opencodeArgs?: string; agentCli?: 'claude' | 'codex' | 'grok' | 'opencode' }) => void) => () => void
  autopilotKeyExists: (provider: 'anthropic' | 'openrouter') => Promise<boolean>
  autopilotKeySet: (provider: 'anthropic' | 'openrouter', key: string) => Promise<void>
  autopilotKeyClear: (provider: 'anthropic' | 'openrouter') => Promise<void>
  autopilotStart: (args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number; maxIterations: number }) => Promise<{ ok: boolean; error?: string }>
  autopilotProStart: (args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number }) => Promise<{ ok: boolean; error?: string }>
  autopilotCouncilStart: (args: {
    terminalId: string
    projectPath: string
    freeTextIdea: string
    costCapUsd: number
    implementerCli: 'claude' | 'codex' | 'grok' | 'opencode'
    reviewerCli: 'claude' | 'codex' | 'grok' | 'opencode'
    intensity: CouncilIntensity
  }) => Promise<{ ok: boolean; error?: string; warnings?: string[] }>
  autopilotProRunMeta: (terminalId: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>
  autopilotPause: (terminalId: string) => Promise<void>
  autopilotResume: (terminalId: string) => Promise<void>
  autopilotStop: (terminalId: string) => Promise<void>
  autopilotApproveGoal: (terminalId: string) => Promise<void>
  autopilotReplyToWaiting: (terminalId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  autopilotPermissionAllow: (terminalId: string) => Promise<void>
  autopilotPermissionDeny: (terminalId: string) => Promise<void>
  autopilotGetStatus: (terminalId: string) => Promise<unknown>
  autopilotInspectOutput: (terminalId: string) => Promise<unknown>
  autopilotProbeArtifacts: (projectPath: string) => Promise<{ hasClassic: boolean; hasPro: boolean; hasCouncil: boolean }>
  autopilotAttachDraft: (args: {
    terminalId: string
    userAnswer?: string
    useLlm: boolean
  }) => Promise<{
    ok: boolean
    draft?: AttachDraft
    error?: string
  }>
  autopilotAttachConfirm: (args: {
    terminalId: string
    bridgePrompt: string
  }) => Promise<{
    ok: boolean
    status?: AttachSessionStatus
    error?: string
  }>
  autopilotAttachStatus: (terminalId: string) => Promise<AttachSessionStatus | null>
  autopilotAttachCancel: (terminalId: string) => Promise<{ ok: boolean }>
  broadcastRefine: (args: { text: string; targetLabels?: string[] }) => Promise<{ ok: boolean; text?: string; error?: string }>
  broadcastSend: (args: { terminalIds: string[]; text: string; autoRefine?: boolean; targetLabels?: string[]; projects?: string[]; originalText?: string; model?: string }) => Promise<{ ok: boolean; results: Array<{ id: string; ok: boolean; error?: string }>; sentText?: string; originalText?: string; refineError?: string }>
  aiUsageSummary: () => Promise<AiUsageSummary>
  terminalListExternal: () => Promise<Array<{ id: string; name: string }>>
  terminalOpenExternal: (args: { folderPath: string; id?: string }) => Promise<{ ok: boolean; name?: string; error?: string }>
  promptsList: (args?: { limit?: number; offset?: number }) => Promise<PromptRecord[]>
  promptsDelete: (id: number) => Promise<{ ok: boolean }>
  promptsClear: () => Promise<{ ok: boolean }>
  promptsCount: () => Promise<number>
  onAutopilotUpdate: (callback: (terminalId: string, state: unknown) => void) => () => void
}


declare global {
  interface Window {
    api: ElectronAPI
  }
}
