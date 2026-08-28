import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Platform info (synchronous — available immediately)
  platform: process.platform as 'win32' | 'darwin' | 'linux',

  // Absolute path of a dropped File. Electron removed the non-standard
  // File.path in v32; webUtils is the supported replacement and is only
  // reachable from the preload, so the renderer has to come through here.
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  // Existing PTY methods. `elevated` spawns the shell through an elevation
  // bridge (gsudo / sudo inline) so the tile hosts an admin shell.
  createTerminal: (id: string, cwd: string, agentCli?: 'claude' | 'codex' | 'grok' | 'opencode', launchArgs?: string, elevated?: boolean): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd, agentCli, launchArgs, elevated),

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

  recentRemove: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('recent:remove', folderPath),

  // Clipboard image — saves to .screenshots/ in project folder, returns path
  clipboardSaveImage: (cwd: string): Promise<string | null> =>
    ipcRenderer.invoke('clipboard:saveImage', cwd),

  // Clipboard file references — returns array of absolute paths, or null
  clipboardReadFiles: (): Promise<string[] | null> =>
    ipcRenderer.invoke('clipboard:readFiles'),

  // Write plain text to the OS clipboard (reliable main-process path)
  clipboardWriteText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:writeText', text),

  // Open a file/folder with the OS default program (path or file:// URL)
  openPath: (target: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openPath', target),

  // How "Run as administrator" opens: 'in-app' (elevation bridge available,
  // tile-hosted) or 'external' (separate elevated OS window)
  adminShellMode: (): Promise<'in-app' | 'external'> =>
    ipcRenderer.invoke('shell:adminShellMode'),

  // Launch an elevated (admin) shell in its own OS window — Windows only
  openAdminShell: (): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openAdminShell'),

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

  settingsGetAll: (): Promise<{ editor: string; defaultAgentCli: 'claude' | 'codex' | 'grok' | 'opencode'; claudeArgs: string; codexArgs: string; grokArgs: string; opencodeArgs: string; askBeforeLaunch: boolean; defaultViewMode: 'grid' | 'focused'; notifyOnIdle: boolean; projectsRoot: string; remoteAccess: boolean; remotePort: number; favoriteFolders: string[]; terminalFontFamily: string; terminalFontSize: number; appFontFamily: string; uiScalePct: number }> =>
    ipcRenderer.invoke('settings:getAll'),

  settingsSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  agentCliAvailability: (): Promise<Record<'claude' | 'codex' | 'grok' | 'opencode', { available: boolean; path: string | null }>> =>
    ipcRenderer.invoke('agent-cli:availability'),

  // Budget tracker (daily Autopilot cost cap)
  settingsGetBudgetState: (projectPath: string) =>
    ipcRenderer.invoke('settings:getBudgetState', projectPath),

  settingsSetBudgetCap: (scope: 'project' | 'global', projectPath: string | null, capUsd: number) =>
    ipcRenderer.invoke('settings:setBudgetCap', scope, projectPath, capUsd),

  settingsResetTodaySpend: () =>
    ipcRenderer.invoke('settings:resetTodaySpend'),

  // Window management
  windowCreate: (): Promise<string> =>
    ipcRenderer.invoke('window:create'),

  windowList: (): Promise<Array<{ id: string; label: string }>> =>
    ipcRenderer.invoke('window:list'),

  // Window-close confirmation: main asks, renderer shows the in-app dialog
  // and confirms back if the user accepts.
  onWindowCloseRequest: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('window:close-request', listener)
    return () => { ipcRenderer.removeListener('window:close-request', listener) }
  },

  windowConfirmClose: (): Promise<void> =>
    ipcRenderer.invoke('window:confirmClose'),

  // Open URL in system browser. `source` names the renderer path that asked
  // (osc8 | weblinks | path-provider | ui) — logged main-side to diagnose
  // duplicate opens.
  openExternal: (url: string, source?: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url, source),

  // Explorer
  openInExplorer: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('explorer:open', folderPath),

  // Editor (accepts files or directories)
  openInEditor: (
    targetPath: string,
    opts?: { forceFolder?: boolean; editorId?: string; projectPath?: string },
  ): Promise<{ ok: boolean; error?: string; opened?: 'solution' | 'editor'; name?: string }> =>
    ipcRenderer.invoke('editor:open', targetPath, opts),

  editorProbeProject: (folderPath: string): Promise<{ path: string; name: string; kind: 'solution' | 'project' } | null> =>
    ipcRenderer.invoke('editor:probeProject', folderPath),

  editorGetAvailable: (): Promise<Array<{ id: string; name: string; cmd: string }>> =>
    ipcRenderer.invoke('editor:getAvailable'),

  editorGetDefaults: (projectPath?: string): Promise<{ global: string; project: string; resolvedId: string | null }> =>
    ipcRenderer.invoke('editor:getDefaults', projectPath),

  editorSetDefault: (arg: { scope: 'global' | 'project'; editorId: string | null; projectPath?: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('editor:setDefault', arg),

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
  sessionSaveLast: (session: { savedAt: number; projects: Array<{ path: string; claudeArgs: string; codexArgs?: string; grokArgs?: string; opencodeArgs?: string; agentCli?: 'claude' | 'codex' | 'grok' | 'opencode'; isPlainShell: boolean }> }): Promise<void> =>
    ipcRenderer.invoke('session:saveLast', session),

  sessionLoadLast: (): Promise<{ savedAt: number; projects: Array<{ path: string; claudeArgs: string; codexArgs?: string; grokArgs?: string; opencodeArgs?: string; agentCli?: 'claude' | 'codex' | 'grok' | 'opencode'; isPlainShell: boolean }> } | null> =>
    ipcRenderer.invoke('session:loadLast'),

  sessionClearLast: (): Promise<void> =>
    ipcRenderer.invoke('session:clearLast'),

  // Git status (cached, 30s TTL)
  gitStatus: (path: string, fresh?: boolean): Promise<{ isRepo: boolean; branch: string | null; dirty: boolean; ahead: number }> =>
    ipcRenderer.invoke('git:status', path, fresh),

  // Build info for About tab
  getBuildInfo: (): Promise<{ electron: string; chrome: string; node: string; platform: string; release: string }> =>
    ipcRenderer.invoke('get-build-info'),

  // Remote access
  remoteToggle: (enabled: boolean): Promise<{ ok: boolean; urls?: string[]; port?: number; error?: string }> =>
    ipcRenderer.invoke('remote:toggle', enabled),

  remoteStatus: (): Promise<{ running: boolean; port: number; urls: string[] }> =>
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

  onRemoteSessionCreated: (callback: (session: { id: string; path: string; name: string; color: string; claudeArgs: string; codexArgs?: string; grokArgs?: string; opencodeArgs?: string; agentCli?: 'claude' | 'codex' | 'grok' | 'opencode' }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, session: any): void => callback(session)
    ipcRenderer.on('remote:session-created', listener)
    return () => { ipcRenderer.removeListener('remote:session-created', listener) }
  },

  autopilotKeyExists: (provider: 'anthropic' | 'openrouter'): Promise<boolean> =>
    ipcRenderer.invoke('autopilot:keyExists', provider),
  autopilotKeySet: (provider: 'anthropic' | 'openrouter', key: string): Promise<void> =>
    ipcRenderer.invoke('autopilot:keySet', provider, key),
  autopilotKeyClear: (provider: 'anthropic' | 'openrouter'): Promise<void> =>
    ipcRenderer.invoke('autopilot:keyClear', provider),
  autopilotStart: (args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number; maxIterations: number }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('autopilot:start', args),
  autopilotProStart: (args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('autopilot-pro:start', args),
  autopilotCouncilStart: (args: {
    terminalId: string
    projectPath: string
    freeTextIdea: string
    costCapUsd: number
    implementerCli: 'claude' | 'codex' | 'grok' | 'opencode'
    reviewerCli: 'claude' | 'codex' | 'grok' | 'opencode'
    intensity: 'light' | 'balanced' | 'strict'
  }): Promise<{ ok: boolean; error?: string; warnings?: string[] }> =>
    ipcRenderer.invoke('autopilot-council:start', args),
  autopilotProRunMeta: (terminalId: string): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    ipcRenderer.invoke('autopilot-pro:runMeta', terminalId),
  autopilotPause: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('autopilot:pause', terminalId),
  autopilotResume: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('autopilot:resume', terminalId),
  autopilotStop: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('autopilot:stop', terminalId),
  autopilotApproveGoal: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('autopilot:approveGoal', terminalId),
  autopilotReplyToWaiting: (terminalId: string, text: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('autopilot:replyToWaiting', terminalId, text),
  autopilotPermissionAllow: (terminalId: string) =>
    ipcRenderer.invoke('autopilot:permissionAllow', terminalId),
  autopilotPermissionDeny: (terminalId: string) =>
    ipcRenderer.invoke('autopilot:permissionDeny', terminalId),
  autopilotGetStatus: (terminalId: string): Promise<unknown> =>
    ipcRenderer.invoke('autopilot:getStatus', terminalId),
  autopilotInspectOutput: (terminalId: string): Promise<unknown> =>
    ipcRenderer.invoke('autopilot:inspectOutput', terminalId),
  autopilotProbeArtifacts: (projectPath: string) =>
    ipcRenderer.invoke('autopilot:probeArtifacts', projectPath),
  autopilotAttachDraft: (args: { terminalId: string; userAnswer?: string; useLlm: boolean }) =>
    ipcRenderer.invoke('autopilot:attachDraft', args),
  autopilotAttachConfirm: (args: { terminalId: string; bridgePrompt: string }) =>
    ipcRenderer.invoke('autopilot:attachConfirm', args),
  autopilotAttachStatus: (terminalId: string) =>
    ipcRenderer.invoke('autopilot:attachStatus', terminalId),
  autopilotAttachCancel: (terminalId: string) =>
    ipcRenderer.invoke('autopilot:attachCancel', terminalId),
  broadcastRefine: (args: { text: string; targetLabels?: string[] }): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('broadcast:refine', args),
  broadcastSend: (args: {
    terminalIds: string[]
    text: string
    autoRefine?: boolean
    targetLabels?: string[]
    projects?: string[]
    originalText?: string
    model?: string
  }): Promise<{ ok: boolean; results: Array<{ id: string; ok: boolean; error?: string }>; sentText?: string; originalText?: string; refineError?: string }> =>
    ipcRenderer.invoke('broadcast:send', args),

  aiUsageSummary: (): Promise<{
    sites: Array<{ id: string; label: string; what: string; model: string; provider: 'anthropic' | 'openrouter'; setting: string }>
    keys: { anthropic: boolean; openrouter: boolean }
    refine: { count: number; byModel: Record<string, number>; avgMs: number | null }
    broadcastsLogged: number
  }> => ipcRenderer.invoke('ai:usageSummary'),

  // External terminal at a folder
  terminalListExternal: (): Promise<Array<{ id: string; name: string }>> =>
    ipcRenderer.invoke('terminal:listExternal'),
  terminalOpenExternal: (args: { folderPath: string; id?: string }): Promise<{ ok: boolean; name?: string; error?: string }> =>
    ipcRenderer.invoke('terminal:openExternal', args),

  // Broadcast prompt history
  promptsList: (args?: { limit?: number; offset?: number }): Promise<Array<{
    id: number; sentAt: number; targets: string[]; projects: string[];
    originalText: string; refinedText: string | null; model: string | null;
    refineMs: number | null; ok: boolean
  }>> => ipcRenderer.invoke('prompts:list', args),
  promptsDelete: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('prompts:delete', id),
  promptsClear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('prompts:clear'),
  promptsCount: (): Promise<number> => ipcRenderer.invoke('prompts:count'),
  onAutopilotUpdate: (callback: (terminalId: string, state: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, terminalId: string, state: unknown) => callback(terminalId, state)
    ipcRenderer.on('autopilot:update', listener)
    return () => { ipcRenderer.removeListener('autopilot:update', listener) }
  },
})
