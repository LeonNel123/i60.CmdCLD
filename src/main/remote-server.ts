import express from 'express'
import { createServer, Server as HttpServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import { join } from 'path'
import { existsSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { networkInterfaces } from 'os'
import type { AddressInfo } from 'net'
import type { PtyManager, TerminalMeta } from './pty-manager'
import { isRequestAllowed } from './remote-guard'
import { QueuedPtyWriter } from './autopilot/pty-input-queue'
import { Settings } from './settings'
import { RecentDB } from './recent-db'
import { trustFolder } from './claude-config'
import {
  buildAgentLaunchCommand,
  getArgsForAgent,
  normalizeAgentCli,
  type AgentCli,
} from '../shared/agent-cli'
import { detectAgentCliAvailability } from './agent-cli-detect'

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Normalise a composed message for submission.
 *
 * Internal newlines are preserved as \n so bracketed paste delivers the whole
 * thing as ONE message. Converting them to \r (the old behaviour) submits each
 * line separately, turning a multi-paragraph prompt into several messages.
 *
 * Returns null when there is nothing to send.
 */
export function normalizeSubmitText(raw: string): string | null {
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalised.replace(/^[\s]+|[\s]+$/g, '')
  return trimmed ? trimmed : null
}

export class RemoteServer {
  private app: ReturnType<typeof express> | null = null
  private httpServer: HttpServer | null = null
  private io: SocketServer | null = null
  private ptyManager: PtyManager
  private settings: Settings
  private recentDB: RecentDB
  private getWebContents: () => Electron.WebContents | null
  private startTime: number = 0
  private boundListeners: { event: string; fn: (...args: any[]) => void }[] = []
  // Composed messages only. Raw keystrokes must never go through this — the
  // submit delay and chunking would break interactive typing.
  private submitWriter: QueuedPtyWriter

  constructor(opts: {
    ptyManager: PtyManager
    settings: Settings
    recentDB: RecentDB
    getWebContents: () => Electron.WebContents | null
  }) {
    this.ptyManager = opts.ptyManager
    this.submitWriter = new QueuedPtyWriter(
      (id, data) => this.ptyManager.write(id, data),
      { existsRaw: (id) => this.ptyManager.has(id) },
    )
    this.settings = opts.settings
    this.recentDB = opts.recentDB
    this.getWebContents = opts.getWebContents
  }

  start(port: number): Promise<{ port: number; urls: string[] }> {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        reject(new Error('Server already running'))
        return
      }

      this.startTime = Date.now()
      const lanAccess = this.settings.get('remoteLanAccess')
      const guardOpts = {
        lanAccess,
        lanAddresses: lanAccess ? this.getLanAddresses() : [],
      }
      this.app = express()
      // Host/Origin gate — registered before static files and the API so
      // every route is covered. Kills DNS rebinding + cross-site sockets.
      this.app.use((req: any, res: any, next: any) => {
        if (isRequestAllowed(req.headers.host, req.headers.origin, guardOpts)) { next(); return }
        res.status(403).json({ error: 'Forbidden' })
      })
      this.app.use(express.json())
      this.httpServer = createServer(this.app)
      this.io = new SocketServer(this.httpServer, {
        allowRequest: (req, callback) => {
          callback(null, isRequestAllowed(req.headers.host, req.headers.origin as string | undefined, guardOpts))
        },
      })

      this.setupStaticFiles()
      this.setupRestApi()
      this.setupSocketEvents()
      this.setupPtyListeners()

      // Loopback by default; 0.0.0.0 only when the user opted into LAN mode.
      let started = false
      this.httpServer.listen(port, lanAccess ? '0.0.0.0' : '127.0.0.1', () => {
        started = true
        const boundPort = (this.httpServer!.address() as AddressInfo).port
        resolve({ port: boundPort, urls: this.getLocalUrls(boundPort) })
      })

      this.httpServer.on('error', (err) => {
        // Bind-time failure rejects start(); a runtime error after listen
        // must not call reject() on a settled promise or silently tear down.
        if (started) {
          console.error('[remote-server] runtime error:', err)
          return
        }
        this.cleanup()
        reject(err)
      })
    })
  }

  stop(): void {
    this.cleanup()
  }

  isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening
  }

  getUrls(port: number): string[] {
    return this.getLocalUrls(port)
  }

  private cleanup(): void {
    if (this.io) {
      this.io.close()
      this.io = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    this.app = null
    for (const { event, fn } of this.boundListeners) {
      this.ptyManager.off(event, fn)
    }
    this.boundListeners = []
  }

  private getLanAddresses(): string[] {
    const out: string[] = []
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) out.push(net.address.toLowerCase())
      }
    }
    return out
  }

  private getLocalUrls(port: number): string[] {
    // Bound to loopback: LAN URLs would be dead links. Tailscale serve
    // (which proxies to localhost) is surfaced separately by the settings UI.
    if (!this.settings.get('remoteLanAccess')) {
      return [`http://localhost:${port}`]
    }
    const urls: string[] = []
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          urls.push(`http://${net.address}:${port}`)
        }
      }
    }
    if (urls.length === 0) {
      urls.push(`http://localhost:${port}`)
    }
    return urls
  }

  private setupStaticFiles(): void {
    if (!this.app) return

    // Serve remote UI files
    const devUiPath = join(__dirname, '../../src/remote-ui')
    const prodUiPath = join(__dirname, '../remote-ui')
    const uiPath = existsSync(devUiPath) ? devUiPath : prodUiPath

    // Serve xterm vendor files — bundled in remote-ui/vendor (production) or from node_modules (dev)
    const bundledVendor = join(uiPath, 'vendor/xterm')
    if (existsSync(bundledVendor)) {
      this.app.use('/vendor/xterm', express.static(join(uiPath, 'vendor/xterm')))
      this.app.use('/vendor/xterm-addon-fit', express.static(join(uiPath, 'vendor/xterm-addon-fit')))
    } else {
      const nodeModules = join(__dirname, '../../node_modules')
      const prodNodeModules = join(__dirname, '../../../node_modules')
      const nmPath = existsSync(nodeModules) ? nodeModules : prodNodeModules
      this.app.use('/vendor/xterm', express.static(join(nmPath, '@xterm/xterm')))
      // Map xterm-addon-fit.js -> addon-fit.js (package renamed the file)
      this.app.get('/vendor/xterm-addon-fit/lib/xterm-addon-fit.js', (_req: any, res: any) => {
        res.sendFile(join(nmPath, '@xterm/addon-fit/lib/addon-fit.js'))
      })
    }

    this.app.use(express.static(uiPath))
    this.app.get('/', (_req: any, res: any) => {
      res.sendFile(join(uiPath, 'index.html'))
    })
  }

  private setupRestApi(): void {
    if (!this.app) return
    const app = this.app

    // Status
    app.get('/api/status', (_req: any, res: any) => {
      let version = 'unknown'
      try { version = require('../../package.json').version } catch {}
      res.json({
        version,
        uptime: Date.now() - this.startTime,
        sessions: this.ptyManager.listAll().length,
      })
    })

    // Sessions
    app.get('/api/sessions', (_req: any, res: any) => {
      const sessions = this.ptyManager.listAll()
      res.json(sessions)
    })

    app.post('/api/sessions', (req: any, res: any) => {
      const { path: cwd, agentCli: agentCliRaw, claudeArgs, codexArgs, grokArgs, opencodeArgs } = req.body
      if (!cwd || typeof cwd !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      try {
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          res.status(400).json({ error: 'Invalid directory path' })
          return
        }
      } catch {
        res.status(400).json({ error: 'Invalid directory path' })
        return
      }

      const id = crypto.randomUUID()
      const name = cwd.split(/[\\/]/).pop() || cwd
      const agentCli = normalizeAgentCli(agentCliRaw)
      const argsByAgent: Record<AgentCli, string> = {
        claude: typeof claudeArgs === 'string' ? claudeArgs : this.settings.get('claudeArgs'),
        codex: typeof codexArgs === 'string' ? codexArgs : this.settings.get('codexArgs'),
        grok: typeof grokArgs === 'string' ? grokArgs : this.settings.get('grokArgs'),
        opencode: typeof opencodeArgs === 'string' ? opencodeArgs : this.settings.get('opencodeArgs'),
      }
      const args = getArgsForAgent(agentCli, {
        claudeArgs: argsByAgent.claude,
        codexArgs: argsByAgent.codex,
        grokArgs: argsByAgent.grok,
        opencodeArgs: argsByAgent.opencode,
      })
      const meta: TerminalMeta = { id, path: cwd, name, color: '', agentCli, launchArgs: args }
      const wc = this.getWebContents()

      if (!wc) {
        res.status(500).json({ error: 'No active window' })
        return
      }

      if (agentCli === 'claude') trustFolder(cwd)
      this.ptyManager.create(id, cwd, wc, meta)

      // Track in recent folders (idempotent upsert — same behaviour as the
      // desktop createTerminal path). Swallow errors so a DB issue never
      // breaks session creation.
      this.recentDB.add(cwd).catch(() => {})

      // Launch the selected agent CLI in the PTY.
      const launchCmd = buildAgentLaunchCommand(agentCli, args)
      setTimeout(() => {
        this.ptyManager.write(id, launchCmd)
      }, 1000)

      // Notify renderer to add this session to its UI
      try {
        if (!wc.isDestroyed()) {
          wc.send('remote:session-created', {
            id,
            path: cwd,
            name,
            color: '',
            agentCli,
            claudeArgs: argsByAgent.claude,
            codexArgs: argsByAgent.codex,
            grokArgs: argsByAgent.grok,
        opencodeArgs: argsByAgent.opencode,
          })
        }
      } catch {}

      res.json({ id, name, path: cwd })
    })

    app.delete('/api/sessions/:id', (req: any, res: any) => {
      const { id } = req.params
      if (!this.ptyManager.has(id)) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      this.ptyManager.kill(id)
      res.json({ ok: true })
    })

    app.get('/api/sessions/:id/scrollback', (req: any, res: any) => {
      const { id } = req.params
      const scrollback = this.ptyManager.getScrollback(id)
      const size = this.ptyManager.getSize(id)
      res.json({ scrollback, cols: size.cols, rows: size.rows })
    })

    // Folders
    app.get('/api/folders/recent', async (_req: any, res: any) => {
      const folders = await this.recentDB.list()
      res.json(folders)
    })

    app.delete('/api/folders/recent', async (req: any, res: any) => {
      const { path: folderPath } = req.body
      if (!folderPath || typeof folderPath !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      try {
        await this.recentDB.remove(folderPath)
        res.json({ ok: true })
      } catch {
        res.status(500).json({ error: 'failed to remove' })
      }
    })

    app.get('/api/folders/favorites', (_req: any, res: any) => {
      res.json(this.settings.get('favoriteFolders'))
    })

    app.put('/api/folders/favorites', (req: any, res: any) => {
      const { folders } = req.body
      if (!Array.isArray(folders)) {
        res.status(400).json({ error: 'folders must be an array' })
        return
      }
      this.settings.set('favoriteFolders', folders)
      res.json({ ok: true })
    })

    // Settings
    app.get('/api/settings', (_req: any, res: any) => {
      const all = this.settings.getAll()
      res.json({
        defaultAgentCli: all.defaultAgentCli,
        claudeArgs: all.claudeArgs,
        codexArgs: all.codexArgs,
        grokArgs: all.grokArgs,
        opencodeArgs: all.opencodeArgs,
        cliAvailability: detectAgentCliAvailability(),
      })
    })

    // Image upload
    app.post('/api/sessions/:id/upload-image', (req: any, res: any) => {
      const { id } = req.params
      const meta = this.ptyManager.getMeta(id)
      if (!meta) {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const chunks: Buffer[] = []
      let totalSize = 0
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length
        if (totalSize > MAX_UPLOAD_SIZE) {
          res.status(413).json({ error: 'Upload too large (max 10MB)' })
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (totalSize > MAX_UPLOAD_SIZE) return
        const buffer = Buffer.concat(chunks)
        const screenshotsDir = join(meta.path, '.screenshots')
        mkdirSync(screenshotsDir, { recursive: true })

        const now = new Date()
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}m${String(now.getSeconds()).padStart(2, '0')}s`
        const filePath = join(screenshotsDir, `screenshot-${stamp}.png`)
        writeFileSync(filePath, buffer)

        this.ptyManager.write(id, filePath)
        res.json({ path: filePath })
      })
    })
  }

  private setupSocketEvents(): void {
    if (!this.io) return

    this.io.on('connection', (socket) => {
      socket.emit('sessions:changed', this.ptyManager.listAll())

      // Raw keystroke stream from xterm — must stay unbuffered and unwrapped so
      // control sequences and interactive editing behave normally.
      socket.on('session:input', ({ id, data }: { id: string; data: string }) => {
        if (this.ptyManager.has(id)) {
          this.ptyManager.write(id, data)
        }
      })

      // Composed messages: the mobile input bar and the quick-action buttons.
      //
      // These go through QueuedPtyWriter, which sends the trailing \r as a separate
      // chunk after submitDelayMs and wraps multi-line bodies in bracketed paste.
      // Writing body+Enter in one go lets an agent CLI consume the Enter while it is
      // still processing the text, which drops the submit — the text sits in the
      // input buffer until some later keystroke submits it.
      socket.on('session:submit', ({ id, text }: { id: string; text: string }) => {
        if (typeof text !== 'string' || !this.ptyManager.has(id)) return
        const body = normalizeSubmitText(text)
        if (body === null) return
        void this.submitWriter.write(id, `${body}\r`).catch(() => {})
      })

      // Remote clients can drive the PTY size. The PtyManager broadcasts
      // the authoritative new size back to every connected client (including
      // the desktop renderer via webContents), so all xterm instances update
      // their cols/rows together and wrapping stays coherent. "Last writer
      // wins" — whichever client's layout most recently changed owns the
      // size; idle clients follow along without re-fitting their own DOM.
      socket.on('session:resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
        if (typeof cols === 'number' && typeof rows === 'number' && this.ptyManager.has(id)) {
          this.ptyManager.resize(id, cols, rows)
        }
      })
    })
  }

  private addPtyListener(event: string, fn: (...args: any[]) => void): void {
    this.ptyManager.on(event, fn)
    this.boundListeners.push({ event, fn })
  }

  private setupPtyListeners(): void {
    this.addPtyListener('data', ({ id, data }: { id: string; data: string }) => {
      if (this.io) {
        this.io.emit('session:output', { id, data })
      }
    })

    this.addPtyListener('exit', ({ id, exitCode }: { id: string; exitCode: number }) => {
      if (this.io) {
        this.io.emit('session:exit', { id, exitCode })
        this.io.emit('sessions:changed', this.ptyManager.listAll())
      }
    })

    this.addPtyListener('created', ({ id, meta }: { id: string; meta: TerminalMeta }) => {
      if (this.io) {
        this.io.emit('session:created', meta)
        this.io.emit('sessions:changed', this.ptyManager.listAll())
      }
    })

    this.addPtyListener('resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
      if (this.io) {
        this.io.emit('session:resize', { id, cols, rows })
      }
    })
  }
}
