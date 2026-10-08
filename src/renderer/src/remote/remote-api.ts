import type { ElectronAPI } from '../types/api'
import type { FetchJson } from './fetch-json'

export interface SocketLike {
  connected: boolean
  on(event: string, cb: (...args: any[]) => void): void
  off(event: string, cb: (...args: any[]) => void): void
  emit(event: string, payload: unknown): void
}

export interface RemoteStatus {
  platform: 'win32' | 'darwin' | 'linux'
  homeDir: string
  version: string
  buildInfo: { electron: string; chrome: string; node: string; platform: string; release: string }
}

export interface RemoteApiDeps {
  socket: SocketLike
  fetchJson: FetchJson
  status: RemoteStatus
  promptForPath: () => Promise<string | null>
  copyText: (text: string) => boolean
}

type Listener<T> = (payload: T) => void

/** Per-id subscriber registry for one server event. One socket listener is
 *  attached at construction; subscribers are looked up by id on each event. */
function fanOut<T extends { id: string }>(socket: SocketLike, event: string) {
  const subs = new Map<string, Set<Listener<T>>>()
  socket.on(event, (msg: T) => {
    if (!msg || typeof msg.id !== 'string') return
    const set = subs.get(msg.id)
    if (!set) return
    for (const cb of [...set]) cb(msg)
  })
  return (id: string, cb: Listener<T>): (() => void) => {
    let set = subs.get(id)
    if (!set) { set = new Set(); subs.set(id, set) }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) subs.delete(id)
    }
  }
}

export function createRemoteApi(deps: RemoteApiDeps): ElectronAPI & { remote: true } {
  const { socket, fetchJson, status } = deps
  const post = <T,>(path: string, body: unknown) =>
    fetchJson<T>(path, { method: 'POST', body: JSON.stringify(body) })

  const onOutput = fanOut<{ id: string; data: string }>(socket, 'session:output')
  const onExit = fanOut<{ id: string; exitCode: number }>(socket, 'session:exit')
  const onResize = fanOut<{ id: string; cols: number; rows: number }>(socket, 'session:resize')

  const noop = async () => {}
  const unsub = () => () => {}
  const q = (params: Record<string, string | undefined>) =>
    '?' + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

  const api: ElectronAPI & { remote: true } = {
    remote: true,
    platform: status.platform,
    getPathForFile: () => '',

    // ---- terminal lifecycle --------------------------------------------
    createTerminal: async (id, cwd, agentCli, launchArgs, _elevated, size) => {
      await post('/api/sessions', { id, path: cwd, agentCli, launchArgs, size })
    },
    writeTerminal: async (id, data) => { socket.emit('session:input', { id, data }) },
    resizeTerminal: async (id, cols, rows) => { socket.emit('session:resize', { id, cols, rows }) },
    killTerminal: async (id) => { await fetchJson(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
    getScrollback: async (id) =>
      (await fetchJson<{ scrollback: string }>(`/api/sessions/${encodeURIComponent(id)}/scrollback`)).scrollback ?? '',
    terminalExists: async (id) =>
      (await fetchJson<Array<{ id: string }>>('/api/sessions')).some((s) => s.id === id),
    terminalListLive: () => fetchJson('/api/sessions'),
    onTerminalData: (id, cb) => onOutput(id, (m) => cb(m.data)),
    onTerminalExit: (id, cb) => onExit(id, (m) => cb(m.exitCode)),
    onTerminalResize: (id, cb) => onResize(id, (m) => cb({ cols: m.cols, rows: m.rows })),

    // ---- folders / recents / settings ----------------------------------
    selectFolder: () => deps.promptForPath(),
    loadState: async () => null,
    saveState: noop,
    recentList: () => fetchJson('/api/folders/recent'),
    recentAdd: async (p) => { await post('/api/folders/recent', { path: p }) },
    recentRemove: async (p) => { await fetchJson('/api/folders/recent', { method: 'DELETE', body: JSON.stringify({ path: p }) }) },
    recentCheckPath: async (p) => (await fetchJson<{ status: 'ok' | 'missing' | 'unmounted' }>('/api/folders/check' + q({ path: p }))).status,
    settingsGetAll: () => fetchJson('/api/settings'),
    settingsSet: async (key, value) => { await post('/api/settings', { key, value }) },
    agentCliAvailability: async () =>
      (await fetchJson<{ cliAvailability: any }>('/api/settings')).cliAvailability ?? {},
    gitStatus: (p, fresh) => fetchJson('/api/git/status' + q({ path: p, fresh: fresh ? '1' : undefined })),
    getHomeDir: async () => status.homeDir,
    getVersion: async () => status.version,
    getBuildInfo: async () => status.buildInfo,

    // ---- session restore: remote never touches the desktop's file -------
    sessionLoadLast: async () => null,
    sessionSaveLast: noop,
    sessionClearLast: noop,

    // ---- clipboard --------------------------------------------------------
    // Image paste on the browser page goes through TerminalPanel's paste
    // handler → clipboardSaveImage. A browser cannot read the clipboard on
    // demand over plain http, so this resolves null; the panel then falls
    // back to text paste. Image upload remains available via the phone UI.
    clipboardSaveImage: async () => null,
    clipboardReadFiles: async () => null,
    clipboardWriteText: async (text) => { deps.copyText(text) },

    // ---- desktop-only: stubs -----------------------------------------------
    openPath: async () => ({ ok: false, error: 'Not available remotely' }),
    adminShellMode: async () => 'external' as const,
    openAdminShell: async () => ({ ok: false, error: 'Not available remotely' }),
    readFile: async () => null,
    projectCreate: async () => null,
    openrouterModels: async () => ({ fetchedAt: 0, models: [] }),
    settingsGetBudgetState: async () => ({
      state: { date: '', perProject: {}, global: { spentUsd: 0, capUsd: 0 } },
      snapshot: {
        date: '', projectSpent: 0, projectCap: 0, globalSpent: 0, globalCap: 0,
        capReached: false, capReachedReason: null, warningThreshold: false,
      },
    }),
    settingsSetBudgetCap: async () => ({ ok: false, error: 'Not available remotely' }),
    settingsResetTodaySpend: async () => ({ ok: false }),
    windowCreate: async () => '',
    windowList: async () => [],
    onWindowCloseRequest: unsub,
    windowConfirmClose: noop,
    openExternal: async (url) => { try { window.open(url, '_blank', 'noopener') } catch {} },
    openInExplorer: noop,
    openInEditor: async () => ({ ok: false, error: 'Not available remotely' }),
    editorProbeProject: async () => null,
    editorGetAvailable: async () => [],
    editorGetDefaults: async () => ({ global: '', project: '', resolvedId: null }),
    editorSetDefault: async () => ({ ok: false }),
    onWindowListUpdated: unsub,
    claudeConfigRead: async () => ({ global: {}, local: {} }),
    claudeConfigWrite: noop,
    remoteToggle: async () => ({ ok: false, error: 'Not available remotely' }),
    remoteStatus: async () => ({ running: true, port: 0, urls: [], desktopClients: 1 }),
    onRemoteSizeOwner: unsub,
    tailscaleStatus: async () => ({
      installed: false, loggedIn: false, online: false, httpsEnabled: false,
      httpsHost: null, error: null, serveActive: false, serveUrl: null,
    }),
    tailscaleServeStart: async () => ({ ok: false, error: 'Not available remotely' }),
    tailscaleServeStop: async () => ({ ok: false, error: 'Not available remotely' }),
    onRemoteSessionCreated: unsub,
    autopilotKeyExists: async () => false,
    autopilotKeySet: noop,
    autopilotKeyClear: noop,
    autopilotStart: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotProStart: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotCouncilStart: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotProRunMeta: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotPause: noop,
    autopilotResume: noop,
    autopilotStop: noop,
    autopilotApproveGoal: noop,
    autopilotReplyToWaiting: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotPermissionAllow: async () => undefined,
    autopilotPermissionDeny: async () => undefined,
    autopilotGetStatus: async () => null,
    autopilotInspectOutput: async () => null,
    autopilotProbeArtifacts: async () => ({ hasClassic: false, hasPro: false, hasCouncil: false }),
    autopilotAttachDraft: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotAttachConfirm: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotAttachStatus: async () => null,
    autopilotAttachCancel: async () => ({ ok: false }),
    broadcastRefine: async () => ({ ok: false, error: 'Not available remotely' }),
    broadcastSend: async () => ({ ok: false, results: [] }),
    aiUsageSummary: async () => ({
      sites: [], keys: { anthropic: false, openrouter: false },
      refine: { count: 0, byModel: {}, avgMs: null }, broadcastsLogged: 0,
    }),
    terminalListExternal: async () => [],
    terminalOpenExternal: async () => ({ ok: false, error: 'Not available remotely' }),
    promptsList: async () => [],
    promptsDelete: async () => ({ ok: false }),
    promptsClear: async () => ({ ok: false }),
    promptsCount: async () => 0,
    onAutopilotUpdate: unsub,
  }

  return api
}
