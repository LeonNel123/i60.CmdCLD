import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, Menu, powerSaveBlocker, safeStorage } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import { appendFileSync, existsSync, statSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import * as os from 'os'
import { PtyManager } from './pty-manager'
import { Store } from './store'
import { WindowRegistry } from './window-registry'
import { RecentDB } from './recent-db'
import { Settings } from './settings'
import { LastSessionStore, type SavedSession } from './last-session-store'
import { detectEditors, getDefaultEditor } from './editor-detect'
import { RemoteServer } from './remote-server'
import { hardenGlobalSettings, trustFolder, readClaudeConfig, writeClaudeConfig } from './claude-config'
import { getStatus as tsGetStatus, getServeStatus as tsGetServeStatus, startServe as tsStartServe, stopServe as tsStopServe } from './tailscale'
import { getGitStatus } from './git-status'
import type { TerminalMeta } from './pty-manager'
import { createAutopilot, type AutopilotHandle, type AutopilotState } from './autopilot'
import { createAutopilotPro, type AutopilotProHandle, type AutopilotProOptions } from './autopilot-pro'
import type { ProState } from './autopilot-pro/types'
import type { AutopilotOptions } from './autopilot/types'
import { QueuedPtyWriter } from './autopilot/pty-input-queue'
import { inspectAutopilotOutput } from './autopilot/output-inspector'
import { probeArtifacts } from './autopilot/probe-artifacts'
import { AnthropicClient, OpenRouterClient } from './autopilot/api-client'
import { createDeterministicAttachDraft, createLlmAttachDraft } from './autopilot/attach-session'
import type { AttachSessionStatus } from './autopilot/attach-types'
import { loadBudget, getSnapshot as getBudgetSnapshot, setProjectCap, setGlobalCap, resetTodaySpend } from './autopilot/budget-tracker'
import { detectAgentCliAvailability } from './agent-cli-detect'
import { getArgsForAgent, getAutopilotRuntimeGuardrail, normalizeAgentCli, type AgentCli } from '../shared/agent-cli'

// File logger for debugging startup issues
const logPath = join(app.getPath('userData'), 'cmdcld.log')
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(logPath, line) } catch {}
}

log('=== App starting ===')

function autopilotKeyPath(provider: 'anthropic' | 'openrouter'): string {
  return join(app.getPath('userData'), `autopilot-${provider}-key.bin`)
}

function readAutopilotKey(provider: 'anthropic' | 'openrouter'): string | null {
  const path = autopilotKeyPath(provider)
  if (!existsSync(path)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const raw = readFileSync(path)
    return safeStorage.decryptString(raw)
  } catch {
    return null
  }
}

function writeAutopilotKey(provider: 'anthropic' | 'openrouter', key: string): void {
  const path = autopilotKeyPath(provider)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  const enc = safeStorage.encryptString(key)
  writeFileSync(path, enc)
}

function clearAutopilotKey(provider: 'anthropic' | 'openrouter'): void {
  const path = autopilotKeyPath(provider)
  try { if (existsSync(path)) require('fs').unlinkSync(path) } catch {}
}

// Hydrate PATH and env from the user's login shell when launched from Finder/Dock.
// Packaged macOS apps start with a bare environment (PATH ≈ /usr/bin:/bin:/usr/sbin:/sbin),
// which breaks MCP servers that Claude Code spawns via `npx`, `uvx`, Homebrew `node`, nvm, etc.
// Running the login shell interactively picks up ~/.zshrc / ~/.zprofile / ~/.bash_profile
// so PTYs inherit the same environment the user sees in their terminal.
function hydrateLoginShellEnv(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execSync(`${shell} -ilc 'printf "%s\\0" "$PATH"; env -0'`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const firstNul = out.indexOf('\0')
    const loginPath = firstNul >= 0 ? out.slice(0, firstNul) : ''
    const envBlob = firstNul >= 0 ? out.slice(firstNul + 1) : ''
    if (loginPath) process.env.PATH = loginPath
    for (const entry of envBlob.split('\0')) {
      const eq = entry.indexOf('=')
      if (eq <= 0) continue
      const k = entry.slice(0, eq)
      const v = entry.slice(eq + 1)
      if (k === 'PATH') continue // already set above
      if (process.env[k] == null) process.env[k] = v
    }
    log(`Login shell env hydrated (PATH=${process.env.PATH})`)
  } catch (e) {
    log(`Login shell env hydration FAILED: ${e}`)
  }
}

if (app.isPackaged) {
  hydrateLoginShellEnv()
}

// Single instance lock — only one app process at a time
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log('Single instance lock failed — another instance is running. Exiting.')
  app.exit(0)
}

log('Single instance lock acquired')

let ptyManager: PtyManager
let autopilotPtyWriter: QueuedPtyWriter
let store: Store
let recentDB: RecentDB
let settings: Settings
let lastSessionStore: LastSessionStore
const registry = new WindowRegistry()
let remoteServer: RemoteServer
const newWindowIds = new Set<string>()
// Tracks windows that have already passed the "are you sure?" close dialog,
// so the cascading close event after dialog-OK doesn't re-prompt.
const confirmedClose = new WeakSet<BrowserWindow>()

const autopilots = new Map<string, AutopilotHandle>()  // keyed by terminalId — Classic mode
const autopilotPros = new Map<string, AutopilotProHandle>()  // keyed by terminalId — PRO mode
const attachSessions = new Map<string, AttachSessionStatus>()
const cancelledAttachSessionIds = new Set<string>()
let attachSessionSeq = 0

function makeAutopilotApiClient(provider: 'anthropic' | 'openrouter', apiKey: string, model: string) {
  return provider === 'anthropic'
    ? new AnthropicClient(apiKey, model)
    : new OpenRouterClient(apiKey, model)
}

function broadcastAutopilotUpdate(terminalId: string, state: AutopilotState): void {
  for (const wcId of registry.list().map((w) => w.id)) {
    const wc = registry.getWebContents(wcId)
    if (wc) wc.send('autopilot:update', terminalId, state)
  }
}

function broadcastAutopilotProUpdate(terminalId: string, state: ProState): void {
  for (const wcId of registry.list().map((w) => w.id)) {
    const wc = registry.getWebContents(wcId)
    if (wc) wc.send('autopilot:update', terminalId, state)
  }
}

try {
  ptyManager = new PtyManager()
  autopilotPtyWriter = new QueuedPtyWriter((terminalId, data) => {
    ptyManager.write(terminalId, data)
  })
  store = new Store(join(app.getPath('userData'), 'sessions.json'))
  recentDB = new RecentDB(join(app.getPath('userData'), 'recent.db'))
  settings = new Settings(join(app.getPath('userData'), 'settings.json'))
  lastSessionStore = new LastSessionStore(join(app.getPath('userData'), 'last-session.json'))
  remoteServer = new RemoteServer({
    ptyManager,
    settings,
    recentDB,
    getWebContents: () => {
      const list = registry.list()
      if (list.length === 0) return null
      return registry.getWebContents(list[0].id) || null
    },
  })

  // Auto-detect editors and set default if not configured
  const availableEditors = detectEditors()
  log(`Detected editors: ${availableEditors.map(e => e.name).join(', ') || 'none'}`)
  const currentEditor = settings.get('editor')
  if (!availableEditors.find(e => e.cmd === currentEditor)) {
    const def = getDefaultEditor(availableEditors)
    if (def) settings.set('editor', def.cmd)
  }
  log('All services created')
} catch (e) {
  log(`Service init FAILED: ${e}`)
  throw e
}

// Previously enforced bypass-permissions lockdown; now a no-op.
// Folder trust is still handled per-folder via `trustFolder` in pty:create.
try {
  hardenGlobalSettings()
} catch (e) {
  log(`hardenGlobalSettings failed: ${e}`)
}

function createWindow(opts?: { empty?: boolean; persistedId?: string }): { id: string; window: BrowserWindow } {
  const id = opts?.persistedId || crypto.randomUUID()
  const bounds = store.getWindowBounds(id)
  const isEmpty = opts?.empty ?? false

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 400,
    minHeight: 300,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    backgroundColor: '#1e1e1e',
    title: 'CmdCLD',
  })

  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
  }

  // Open external URLs in the system browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (isEmpty) url.searchParams.set('empty', '1')
    win.loadURL(url.toString())
  } else {
    const filePath = join(__dirname, '../renderer/index.html')
    if (isEmpty) {
      win.loadFile(filePath, { query: { empty: '1' } })
    } else {
      win.loadFile(filePath)
    }
  }

  registry.register(id, win)
  broadcastWindowList()

  // Debounced bounds save — avoids sync I/O on every pixel during drag/resize
  let boundsTimer: ReturnType<typeof setTimeout>
  const saveBounds = (): void => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        store.saveWindowBounds(id, win.getBounds())
      }
    }, 500)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // Confirmation handler — runs FIRST. Only blocks close when the window
  // owns active terminals; otherwise close proceeds straight through.
  // After the user confirms, we mark the window so the second close event
  // (triggered by win.close() below) skips this dialog.
  win.on('close', (e) => {
    if (confirmedClose.has(win)) return
    const owned = ptyManager.listByWebContents(win.webContents)
    if (owned.length === 0) return // nothing running, allow close

    e.preventDefault()
    dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Close window',
      message: 'Close this window?',
      detail: `${owned.length} terminal session${owned.length === 1 ? '' : 's'} will be terminated.`,
    }).then((result) => {
      if (result.response === 0) {
        confirmedClose.add(win)
        win.close()
      }
    }).catch(() => {})
  })

  win.on('close', () => {
    clearTimeout(boundsTimer)
    // Save final bounds
    if (!win.isDestroyed()) {
      store.saveWindowBounds(id, win.getBounds())
    }
    const owned = ptyManager.listByWebContents(win.webContents)
    for (const meta of owned) {
      ptyManager.kill(meta.id)
    }
    registry.unregister(id)
  })

  win.on('closed', () => {
    broadcastWindowList()
    // On non-macOS, quit when last window closes
    if (process.platform !== 'darwin' && registry.size() === 0) {
      app.quit()
    }
  })

  return { id, window: win }
}

function broadcastWindowList(): void {
  const list = registry.list()
  registry.broadcastAll('window:list-updated', list)
}

function getWindowIdFromEvent(event: Electron.IpcMainInvokeEvent): string | undefined {
  const list = registry.list()
  for (const info of list) {
    const wc = registry.getWebContents(info.id)
    if (wc && wc.id === event.sender.id) return info.id
  }
  return undefined
}

// PTY IPC handlers
ipcMain.handle('pty:create', (event, id: string, cwd: string, agentCliRaw?: AgentCli, launchArgsRaw?: string) => {
  const windowId = getWindowIdFromEvent(event)
  if (!windowId) return
  const wc = registry.getWebContents(windowId)
  if (!wc) return
  // Validate cwd is a real directory
  try {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return
  } catch { return }
  // Prevent overwriting existing PTY
  if (ptyManager.getMeta(id)) return
  const name = cwd.split(/[\\/]/).pop() || cwd
  const agentCli = normalizeAgentCli(agentCliRaw)
  const launchArgs = typeof launchArgsRaw === 'string' ? launchArgsRaw : getArgsForAgent(agentCli, {
    claudeArgs: settings.get('claudeArgs'),
    codexArgs: settings.get('codexArgs'),
  })
  const meta: TerminalMeta = { id, path: cwd, name, color: '', agentCli, launchArgs }
  if (agentCli === 'claude') trustFolder(cwd)
  ptyManager.create(id, cwd, wc, meta)
})

ipcMain.handle('pty:write', (_event, id: string, data: string) => {
  ptyManager.write(id, data)
})

ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows)
})

ipcMain.handle('pty:scrollback', (_event, id: string) => {
  return ptyManager.getScrollback(id)
})

ipcMain.handle('pty:kill', (_event, id: string) => {
  ptyManager.kill(id)
})

// Window management
ipcMain.handle('window:create', () => {
  const { id } = createWindow({ empty: true })
  return id
})

ipcMain.handle('window:list', (event) => {
  const callerId = getWindowIdFromEvent(event)
  if (!callerId) return []
  return registry.listExcluding(callerId)
})

// Open URL in system browser
ipcMain.handle('shell:openExternal', (_event, url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url)
  }
})

// Open folder in file manager (cross-platform)
ipcMain.handle('explorer:open', (_event, folderPath: string) => {
  try {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) return
  } catch { return }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const child = spawn(cmd, [folderPath], { detached: true, stdio: 'ignore' })
  child.unref()
})

// Open in editor — uses configured editor
// shell:true is needed on Windows because editors like 'code' are .cmd batch wrappers
// On macOS/Linux they're symlinks that work directly
// Accepts both file paths (from clickable links) and directory paths
ipcMain.handle('editor:open', (_event, targetPath: string) => {
  const cmd = settings.get('editor')
  try {
    if (!existsSync(targetPath)) return
  } catch { return }
  const child = spawn(cmd, [targetPath], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' })
  child.unref()
})

// Editor settings
ipcMain.handle('editor:getAvailable', () => {
  return detectEditors()
})

ipcMain.handle('editor:getCurrent', () => {
  return settings.get('editor')
})

ipcMain.handle('editor:setCurrent', (_event, cmd: string) => {
  settings.set('editor', cmd)
})

// Clipboard image paste — saves to .screenshots/ inside the project folder
ipcMain.handle('clipboard:saveImage', (_event, cwd: string) => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  const screenshotsDir = join(cwd, '.screenshots')
  mkdirSync(screenshotsDir, { recursive: true })
  const now = new Date()
  const ts = now.toISOString().replace(/[T:]/g, '-').replace(/\..+/, '').replace(/-/g, (m, i) => i < 10 ? '-' : i === 10 ? '_' : '')
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}m${String(now.getSeconds()).padStart(2,'0')}s`
  const filePath = join(screenshotsDir, `screenshot-${stamp}.png`)
  writeFileSync(filePath, img.toPNG())
  return filePath
})

// Read file paths from clipboard (for Ctrl+V file-paste)
function readClipboardFilePaths(): string[] | null {
  try {
    if (process.platform === 'win32') {
      // CF_HDROP via FileNameW — UTF-16LE, null-terminated, returns first file
      const buf = clipboard.readBuffer('FileNameW')
      if (!buf || buf.length < 2) return null
      const raw = buf.toString('utf16le')
      const trimmed = raw.replace(/\0+$/, '')
      if (!trimmed) return null
      return [trimmed]
    } else if (process.platform === 'darwin') {
      // public.file-url — single file:// URL
      const raw = clipboard.read('public.file-url')
      if (!raw) return null
      const p = raw.startsWith('file://') ? fileURLToPath(raw) : raw
      if (!p) return null
      return [p]
    } else {
      // Linux: text/uri-list — newline-separated file:// URLs
      const raw = clipboard.read('text/uri-list')
      if (!raw) return null
      const paths = raw
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.startsWith('file://') ? fileURLToPath(line) : line)
        .filter(Boolean)
      return paths.length > 0 ? paths : null
    }
  } catch {
    return null
  }
}

ipcMain.handle('clipboard:readFiles', () => readClipboardFilePaths())

// Settings
ipcMain.handle('settings:getAll', () => {
  return settings.getAll()
})

ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  settings.set(key as any, value as any)
})

ipcMain.handle('agent-cli:availability', () => detectAgentCliAvailability())

// Claude CLI config (global + local settings files)
ipcMain.handle('claude-config:read', () => readClaudeConfig())

ipcMain.handle('claude-config:write', (_event, scope: 'global' | 'local', data: Record<string, unknown>) => {
  writeClaudeConfig(scope, data)
})

// Last-session store — best-effort persistence of the open project set.
// Read at mount in renderer, write debounced on terminals change, flushed
// on beforeunload. Never throws.
ipcMain.handle('session:saveLast', (_event, session: SavedSession) => {
  lastSessionStore.write(session)
})

ipcMain.handle('session:loadLast', () => {
  return lastSessionStore.read()
})

ipcMain.handle('session:clearLast', () => {
  lastSessionStore.clear()
})

ipcMain.handle('git:status', (_event, path: string) => {
  if (typeof path !== 'string' || !path) return { isRepo: false, branch: null, dirty: false }
  return getGitStatus(path)
})

ipcMain.handle('autopilot:keyExists', (_event, provider: 'anthropic' | 'openrouter') => {
  return existsSync(autopilotKeyPath(provider))
})
ipcMain.handle('autopilot:keySet', (_event, provider: 'anthropic' | 'openrouter', key: string) => {
  writeAutopilotKey(provider, key)
})
ipcMain.handle('autopilot:keyClear', (_event, provider: 'anthropic' | 'openrouter') => {
  clearAutopilotKey(provider)
})

function getAutopilotRuntimeStartContext(terminalId: string): { ok: true; agentCli: AgentCli; launchArgs: string } | { ok: false; error: string } {
  const meta = ptyManager.getMeta(terminalId)
  if (!meta) return { ok: false, error: 'Terminal session not found.' }
  const agentCli = normalizeAgentCli(meta.agentCli)
  const launchArgs = meta.launchArgs ?? getArgsForAgent(agentCli, {
    claudeArgs: settings.get('claudeArgs'),
    codexArgs: settings.get('codexArgs'),
  })
  const guardrail = getAutopilotRuntimeGuardrail(agentCli, launchArgs)
  if (!guardrail.canStart) {
    return { ok: false, error: guardrail.reason ?? `${agentCli} Autopilot is blocked by launch guardrails.` }
  }
  return { ok: true, agentCli, launchArgs }
}

ipcMain.handle('autopilot:start', async (_event, args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number; maxIterations: number }) => {
  const provider = settings.get('autopilotApiProvider')
  const apiKey = readAutopilotKey(provider)
  if (!apiKey) return { ok: false, error: `No API key for ${provider}. Add one in Settings.` }
  if (autopilots.has(args.terminalId) || autopilotPros.has(args.terminalId)) return { ok: false, error: 'Autopilot already running for this terminal.' }
  const runtime = getAutopilotRuntimeStartContext(args.terminalId)
  if (!runtime.ok) return runtime

  const opts: AutopilotOptions = {
    terminalId: args.terminalId,
    projectPath: args.projectPath,
    freeTextIdea: args.freeTextIdea,
    agentCli: runtime.agentCli,
    costCapUsd: args.costCapUsd,
    maxIterations: args.maxIterations,
    apiProvider: provider,
    apiKey,
    plannerModel: settings.get('autopilotPlannerModel'),
    writeToPty: (terminalId, data) => { autopilotPtyWriter.write(terminalId, data) },
    onPtyData: (terminalId, listener) => ptyManager.subscribeOutput(terminalId, listener),
    onUpdate: (state) => broadcastAutopilotUpdate(args.terminalId, state),
  }
  const handle = createAutopilot(opts)
  autopilots.set(args.terminalId, handle)
  await handle.start()
  return { ok: true }
})

ipcMain.handle('autopilot:pause', (_event, terminalId: string) => {
  autopilots.get(terminalId)?.pause()
  autopilotPros.get(terminalId)?.pause()
})
ipcMain.handle('autopilot:resume', (_event, terminalId: string) => {
  autopilots.get(terminalId)?.resume()
  autopilotPros.get(terminalId)?.resume()
})
ipcMain.handle('autopilot:stop', (_event, terminalId: string) => {
  autopilots.get(terminalId)?.stop()
  autopilots.delete(terminalId)
  autopilotPros.get(terminalId)?.stop()
  autopilotPros.delete(terminalId)
})
ipcMain.handle('autopilot:approveGoal', (_event, terminalId: string) => {
  autopilots.get(terminalId)?.approveGoal()
  // PRO doesn't use a goal-approve gate — approval is via DECISION_SHAPE: approve.
})
ipcMain.handle('autopilot:replyToWaiting', (_event, terminalId: string, text: string) => {
  autopilots.get(terminalId)?.replyToWaiting(text)
  autopilotPros.get(terminalId)?.replyToWaiting(text)
})
ipcMain.handle('autopilot:permissionAllow', (_event, terminalId: string) => {
  autopilots.get(terminalId)?.respondToPermission('allow')
  autopilotPros.get(terminalId)?.respondToPermission('allow')
})
ipcMain.handle('autopilot:permissionDeny', (_event, terminalId: string) => {
  autopilots.get(terminalId)?.respondToPermission('deny')
  autopilotPros.get(terminalId)?.respondToPermission('deny')
})
ipcMain.handle('autopilot:getStatus', (_event, terminalId: string) => {
  // Prefer PRO state if a PRO instance is active for this terminal; else Classic.
  const pro = autopilotPros.get(terminalId)
  if (pro) return pro.getState()
  return autopilots.get(terminalId)?.state ?? null
})
ipcMain.handle('autopilot:inspectOutput', (_event, terminalId: string) => {
  return inspectAutopilotOutput(ptyManager.getScrollback(terminalId))
})
ipcMain.handle('autopilot:probeArtifacts', (_event, projectPath: string) => {
  return probeArtifacts(projectPath)
})

ipcMain.handle('autopilot:attachDraft', async (_event, args: { terminalId: string; userAnswer?: string; useLlm: boolean }) => {
  if (!ptyManager.has(args.terminalId)) return { ok: false, error: 'Terminal session not found.' }
  if (autopilots.has(args.terminalId) || autopilotPros.has(args.terminalId)) {
    return { ok: false, error: 'Autopilot is already running for this terminal.' }
  }
  const provider = settings.get('autopilotApiProvider')
  const model = settings.get('autopilotPlannerModel')
  const apiKey = readAutopilotKey(provider)
  const request = {
    terminalId: args.terminalId,
    scrollback: ptyManager.getScrollback(args.terminalId),
    useLlm: args.useLlm,
    userAnswer: args.userAnswer,
    providerConfigured: Boolean(apiKey),
    provider,
    model,
  }
  if (!args.useLlm || !apiKey) {
    return { ok: true, draft: createDeterministicAttachDraft(request) }
  }
  const client = makeAutopilotApiClient(provider, apiKey, model)
  return { ok: true, draft: await createLlmAttachDraft({ client, request }) }
})

ipcMain.handle('autopilot:attachConfirm', async (_event, args: { terminalId: string; bridgePrompt: string }) => {
  if (!ptyManager.has(args.terminalId)) return { ok: false, error: 'Terminal session not found.' }
  if (autopilots.has(args.terminalId) || autopilotPros.has(args.terminalId)) {
    return { ok: false, error: 'Autopilot is already running for this terminal.' }
  }
  if (!args.bridgePrompt.trim()) return { ok: false, error: 'Bridge prompt is empty.' }
  const current = attachSessions.get(args.terminalId)
  if (current && (current.status === 'sending_bridge' || current.status === 'watching')) {
    return { ok: false, error: 'Attach is already active for this terminal.', status: current }
  }
  const id = `${args.terminalId}:${++attachSessionSeq}`
  const status: AttachSessionStatus = {
    id,
    terminalId: args.terminalId,
    status: 'sending_bridge',
    baselineOffset: ptyManager.getScrollbackOffset(args.terminalId),
    bridgeSentAt: null,
    lastMarker: null,
    lastError: null,
    message: 'Sending attach bridge prompt.',
  }
  attachSessions.set(args.terminalId, status)
  try {
    await autopilotPtyWriter.write(args.terminalId, args.bridgePrompt)
    const latest = attachSessions.get(args.terminalId)
    if (cancelledAttachSessionIds.has(id) || latest?.id !== id || status.status === 'cancelled') {
      cancelledAttachSessionIds.delete(id)
      status.status = 'cancelled'
      status.message = 'Attach was cancelled.'
      if (latest?.id === id) attachSessions.delete(args.terminalId)
      return { ok: false, error: 'Attach was cancelled.', status }
    }
    status.bridgeSentAt = Date.now()
    status.baselineOffset = ptyManager.getScrollbackOffset(args.terminalId)
    status.status = 'watching'
    status.message = `Watching from output offset ${status.baselineOffset}.`
    return { ok: true, status }
  } catch (e: any) {
    const latest = attachSessions.get(args.terminalId)
    if (cancelledAttachSessionIds.has(id) || latest?.id !== id || status.status === 'cancelled') {
      cancelledAttachSessionIds.delete(id)
      status.status = 'cancelled'
      status.message = 'Attach was cancelled.'
      if (latest?.id === id) attachSessions.delete(args.terminalId)
      return { ok: false, error: 'Attach was cancelled.', status }
    }
    const error = e?.message ?? 'Failed to send attach bridge prompt.'
    status.status = 'failed'
    status.lastError = error
    status.message = error
    return { ok: false, error, status }
  }
})

ipcMain.handle('autopilot:attachStatus', (_event, terminalId: string) => {
  return attachSessions.get(terminalId) ?? null
})

ipcMain.handle('autopilot:attachCancel', (_event, terminalId: string) => {
  const current = attachSessions.get(terminalId)
  if (current) {
    const wasSendingBridge = current.status === 'sending_bridge'
    current.status = 'cancelled'
    current.message = 'Attach cancelled.'
    if (wasSendingBridge) {
      cancelledAttachSessionIds.add(current.id)
    }
  }
  attachSessions.delete(terminalId)
  return { ok: true }
})

// Budget settings — daily cost cap (per-project + global), spend tracker.
ipcMain.handle('settings:getBudgetState', (_event, projectPath: string) => {
  return { state: loadBudget(), snapshot: getBudgetSnapshot(projectPath) }
})

ipcMain.handle('settings:setBudgetCap', (_event, scope: 'project' | 'global', projectPath: string | null, capUsd: number) => {
  if (!Number.isFinite(capUsd) || capUsd < 0) {
    return { ok: false, error: 'cap must be a non-negative finite number' }
  }
  if (scope === 'global') {
    setGlobalCap(capUsd)
  } else if (projectPath) {
    setProjectCap(projectPath, capUsd)
  }
  return { ok: true }
})

ipcMain.handle('settings:resetTodaySpend', () => {
  resetTodaySpend()
  return { ok: true }
})

// ---- PRO-specific handlers ----

ipcMain.handle('autopilot-pro:start', async (_event, args: { terminalId: string; projectPath: string; freeTextIdea: string; costCapUsd: number }) => {
  const provider = settings.get('autopilotApiProvider')
  const apiKey = readAutopilotKey(provider)
  if (!apiKey) return { ok: false, error: `No API key for ${provider}. Add one in Settings.` }
  if (autopilots.has(args.terminalId) || autopilotPros.has(args.terminalId)) {
    return { ok: false, error: 'Autopilot already running for this terminal.' }
  }
  const runtime = getAutopilotRuntimeStartContext(args.terminalId)
  if (!runtime.ok) return runtime

  const opts: AutopilotProOptions = {
    terminalId: args.terminalId,
    projectPath: args.projectPath,
    freeTextIdea: args.freeTextIdea,
    agentCli: runtime.agentCli,
    costCapUsd: args.costCapUsd,
    apiProvider: provider,
    apiKey,
    plannerModel: settings.get('autopilotPlannerModel'),
    writeToPty: (terminalId, data) => { autopilotPtyWriter.write(terminalId, data) },
    onPtyData: (terminalId, listener) => ptyManager.subscribeOutput(terminalId, listener),
    onUpdate: (state) => broadcastAutopilotProUpdate(args.terminalId, state),
  }
  const handle = createAutopilotPro(opts)
  autopilotPros.set(args.terminalId, handle)
  await handle.start()
  return { ok: true }
})

ipcMain.handle('autopilot-pro:runMeta', async (_event, terminalId: string) => {
  const handle = autopilotPros.get(terminalId)
  if (!handle) return { ok: false, error: 'No PRO autopilot running for this terminal.' }
  try {
    const result = await handle.runMeta()
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'meta call failed' }
  }
})

// Keep the app process from being suspended while remote access is on, so a
// headless Mac (mini) stays reachable over Tailscale. Does NOT prevent system
// sleep — the user is expected to set `pmset sleep 0` at the OS level.
let sleepBlockerId: number | null = null
function setSleepBlockEnabled(enabled: boolean): void {
  if (enabled && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    log(`Sleep blocker started (id=${sleepBlockerId})`)
  } else if (!enabled && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId)
    log(`Sleep blocker stopped (id=${sleepBlockerId})`)
    sleepBlockerId = null
  }
}

// Remote access
ipcMain.handle('remote:toggle', async (_event, enabled: boolean) => {
  if (enabled) {
    const port = settings.get('remotePort')
    try {
      const result = await remoteServer.start(port)
      setSleepBlockEnabled(true)
      return { ok: true, urls: result.urls, port: result.port }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Failed to start server' }
    }
  } else {
    remoteServer.stop()
    setSleepBlockEnabled(false)
    return { ok: true }
  }
})

ipcMain.handle('remote:status', () => {
  const port = settings.get('remotePort') as number
  const running = remoteServer.isRunning()
  return {
    running,
    port,
    urls: running ? remoteServer.getUrls(port) : [],
  }
})

// Tailscale HTTPS exposure — shells out to the user's tailscale CLI.
// Requires: tailscale installed, signed in, and HTTPS enabled on the tailnet.
let tsCache: { value: unknown; at: number } | null = null
const TS_CACHE_TTL_MS = 60_000

ipcMain.handle('tailscale:status', async () => {
  if (tsCache && Date.now() - tsCache.at < TS_CACHE_TTL_MS) {
    return tsCache.value
  }
  const status = await tsGetStatus()
  const serve = status.installed ? await tsGetServeStatus() : { active: false, url: null as string | null }
  const result = { ...status, serveActive: serve.active, serveUrl: serve.url }
  tsCache = { value: result, at: Date.now() }
  return result
})

ipcMain.handle('tailscale:serveStart', async () => {
  tsCache = null
  if (!remoteServer.isRunning()) {
    return { ok: false, error: 'Enable Remote Access first.' }
  }
  const port = settings.get('remotePort') as number
  return tsStartServe(port)
})

ipcMain.handle('tailscale:serveStop', async () => {
  tsCache = null
  return tsStopServe()
})

// Get home directory for quick agent sessions
ipcMain.handle('app:getHomeDir', () => {
  return app.getPath('home')
})

// Get app version
ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

// Read file contents (for markdown viewer)
ipcMain.handle('file:read', (_event, filePath: string) => {
  try {
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) return null
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})

// Create new project folder
ipcMain.handle('project:create', (_event, folderName: string) => {
  const root = settings.get('projectsRoot')
  if (!root) return null
  const fullPath = join(root, folderName)
  try {
    if (existsSync(fullPath)) return null // already exists
    mkdirSync(fullPath, { recursive: true })
    return fullPath
  } catch {
    return null
  }
})

// Dialog IPC handler
ipcMain.handle('dialog:selectFolder', async (event) => {
  const windowId = getWindowIdFromEvent(event)
  const win = windowId ? registry.get(windowId) : undefined
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// Recent folders
ipcMain.handle('recent:list', async () => {
  return recentDB.list()
})

ipcMain.handle('recent:add', async (_event, folderPath: string) => {
  await recentDB.add(folderPath)
})

ipcMain.handle('recent-check-path', (_e, p: string) => recentDB.checkPath(p))

ipcMain.handle('get-build-info', () => ({
  electron: process.versions.electron,
  chrome:   process.versions.chrome,
  node:     process.versions.node,
  platform: process.platform,
  release:  os.release(),
}))

// Store IPC handlers
ipcMain.handle('store:load', () => {
  return store.load()
})

ipcMain.handle('store:save', (_event, state) => {
  // Basic validation before saving
  if (state && typeof state === 'object' && Array.isArray(state.windows)) {
    store.save(state)
  }
})

app.whenReady().then(() => {
  log('App ready — creating first window')

  // macOS application menu with standard shortcuts (Cmd+Q, Cmd+W, Edit menu)
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' },
        ],
      },
    ]))
  }

  try {
    createWindow({ persistedId: 'primary' })
    log('First window created successfully')

    // Auto-start remote server if enabled
    if (settings.get('remoteAccess')) {
      const port = settings.get('remotePort')
      remoteServer.start(port).then((result) => {
        log(`Remote server started on port ${result.port}: ${result.urls.join(', ')}`)
        setSleepBlockEnabled(true)
      }).catch((err) => {
        log(`Remote server failed to start: ${err.message}`)
      })
    }
  } catch (e) {
    log(`createWindow FAILED: ${e}`)
  }
})

app.on('second-instance', () => {
  const list = registry.list()
  if (list.length > 0) {
    const win = registry.get(list[0].id)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }
})

app.on('window-all-closed', () => {
  // macOS: keep app running in dock when all windows close
  if (process.platform === 'darwin') {
    log('All windows closed — staying in dock (macOS)')
    return
  }
  log('All windows closed — quitting')
  app.quit()
})

// Cleanup resources when app is quitting (works on all platforms including macOS Cmd+Q)
app.on('before-quit', () => {
  log('App quitting — cleaning up')
  ptyManager.killAll()
  remoteServer.stop()
  recentDB.close()
})

// macOS: re-create window when clicking dock icon with no windows open
app.on('activate', () => {
  if (registry.size() === 0) {
    log('Dock click — creating new window (macOS)')
    createWindow({ persistedId: 'primary' })
  }
})

process.on('uncaughtException', (e) => {
  log(`UNCAUGHT EXCEPTION: ${e.stack || e}`)
})

process.on('unhandledRejection', (e) => {
  log(`UNHANDLED REJECTION: ${e}`)
})
