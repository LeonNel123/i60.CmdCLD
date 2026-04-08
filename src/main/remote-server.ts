import express from 'express'
import { createServer, Server as HttpServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import { join } from 'path'
import { existsSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { networkInterfaces } from 'os'
import { PtyManager, TerminalMeta } from './pty-manager'
import { Settings } from './settings'
import { RecentDB } from './recent-db'

export class RemoteServer {
  private app: ReturnType<typeof express> | null = null
  private httpServer: HttpServer | null = null
  private io: SocketServer | null = null
  private ptyManager: PtyManager
  private settings: Settings
  private recentDB: RecentDB
  private getWebContents: () => Electron.WebContents | null
  private startTime: number = 0

  constructor(opts: {
    ptyManager: PtyManager
    settings: Settings
    recentDB: RecentDB
    getWebContents: () => Electron.WebContents | null
  }) {
    this.ptyManager = opts.ptyManager
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
      this.app = express()
      this.app.use(express.json())
      this.httpServer = createServer(this.app)
      this.io = new SocketServer(this.httpServer, {
        cors: { origin: '*' },
      })

      this.setupStaticFiles()
      this.setupRestApi()
      this.setupSocketEvents()
      this.setupPtyListeners()

      this.httpServer.listen(port, '0.0.0.0', () => {
        const urls = this.getLocalUrls(port)
        resolve({ port, urls })
      })

      this.httpServer.on('error', (err) => {
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
    this.ptyManager.removeAllListeners()
  }

  private getLocalUrls(port: number): string[] {
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

    // Serve xterm.js and socket.io client from node_modules
    const nodeModules = join(__dirname, '../../node_modules')
    const prodNodeModules = join(__dirname, '../../../node_modules')
    const nmPath = existsSync(nodeModules) ? nodeModules : prodNodeModules

    this.app.use('/vendor/xterm', express.static(join(nmPath, '@xterm/xterm')))
    this.app.use('/vendor/xterm-addon-fit', express.static(join(nmPath, '@xterm/addon-fit')))

    // Serve remote UI files
    const devUiPath = join(__dirname, '../../src/remote-ui')
    const prodUiPath = join(__dirname, '../remote-ui')
    const uiPath = existsSync(devUiPath) ? devUiPath : prodUiPath

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
      res.json({
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
      const { path: cwd, claudeArgs } = req.body
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
      const meta: TerminalMeta = { id, path: cwd, name, color: '' }
      const wc = this.getWebContents()

      if (!wc) {
        res.status(500).json({ error: 'No active window' })
        return
      }

      this.ptyManager.create(id, cwd, wc, meta)

      // Launch claude in the PTY
      const args = claudeArgs || this.settings.get('claudeArgs')
      const launchCmd = args ? `claude ${args}\r` : 'claude\r'
      setTimeout(() => {
        this.ptyManager.write(id, launchCmd)
      }, 1000)

      // Notify renderer to add this session to its UI
      try {
        if (!wc.isDestroyed()) {
          wc.send('remote:session-created', { id, path: cwd, name, color: '', claudeArgs: args })
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
      res.json({ scrollback })
    })

    // Folders
    app.get('/api/folders/recent', async (_req: any, res: any) => {
      const folders = await this.recentDB.list()
      res.json(folders)
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
      res.json({ claudeArgs: all.claudeArgs })
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
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
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

      socket.on('session:input', ({ id, data }: { id: string; data: string }) => {
        if (this.ptyManager.has(id)) {
          this.ptyManager.write(id, data)
        }
      })

      socket.on('session:resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
        if (this.ptyManager.has(id)) {
          this.ptyManager.resize(id, cols, rows)
        }
      })
    })
  }

  private setupPtyListeners(): void {
    this.ptyManager.on('data', ({ id, data }: { id: string; data: string }) => {
      if (this.io) {
        this.io.emit('session:output', { id, data })
      }
    })

    this.ptyManager.on('exit', ({ id, exitCode }: { id: string; exitCode: number }) => {
      if (this.io) {
        this.io.emit('session:exit', { id, exitCode })
        this.io.emit('sessions:changed', this.ptyManager.listAll())
      }
    })

    this.ptyManager.on('created', ({ id, meta }: { id: string; meta: TerminalMeta }) => {
      if (this.io) {
        this.io.emit('session:created', meta)
        this.io.emit('sessions:changed', this.ptyManager.listAll())
      }
    })
  }
}
