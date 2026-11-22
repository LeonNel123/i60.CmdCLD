import { describe, it, expect, afterEach, vi } from 'vitest'
import http from 'http'
import { tmpdir } from 'os'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RemoteServer } from '../src/main/remote-server'
import { trustFolder } from '../src/main/claude-config'

// The real trustFolder writes to ~/.claude.json. Left unmocked, every run of
// this file added its temp folders to the developer's own Claude config.
vi.mock('../src/main/claude-config', () => ({ trustFolder: vi.fn() }))

type Created = { id: string; cwd: string; meta: any; size: any }

function fakeDeps(opts: { existingIds?: string[]; settings?: Record<string, unknown>; desktopUiPath?: string } = {}) {
  const created: Created[] = []
  const written: Array<{ id: string; data: string }> = []
  const existing = new Set(opts.existingIds ?? [])
  const values: Record<string, unknown> = {
    remoteLanAccess: false,
    claudeArgs: '', codexArgs: '', grokArgs: '', opencodeArgs: '',
    defaultAgentCli: 'claude',
    defaultViewMode: 'grid',
    terminalFontSize: 14,
    favoriteFolders: [],
    ...(opts.settings ?? {}),
  }
  const setCalls: Array<{ key: string; value: unknown }> = []
  const recentAdds: string[] = []
  const sent: Array<{ channel: string; msg: any }> = []
  const deps = {
    ptyManager: {
      on() {}, off() {},
      listAll() { return [] },
      has(id: string) { return existing.has(id) },
      getMeta(id: string) { return existing.has(id) ? { id } : undefined },
      create(id: string, cwd: string, _wc: unknown, meta: any, _o: unknown, size: any) {
        created.push({ id, cwd, meta, size }); existing.add(id)
      },
      write(id: string, data: string) { written.push({ id, data }) },
      getSize() { return { cols: 80, rows: 24 } },
      getScrollback() { return '' },
      kill() {},
    } as any,
    settings: {
      get: (k: string) => values[k],
      getAll: () => ({ ...values }),
      set: (key: string, value: unknown) => { setCalls.push({ key, value }); values[key] = value },
    } as any,
    recentDB: {
      list: async () => [],
      add: async (p: string) => { recentAdds.push(p) },
      remove: async () => {},
      checkPath: async (p: string) => (p === '/nope' ? 'missing' : 'ok'),
    } as any,
    getWebContents: () => ({ isDestroyed: () => false, send(channel: string, msg: any) { sent.push({ channel, msg }) } }) as any,
    desktopUiPath: opts.desktopUiPath,
  }
  return { deps, created, written, setCalls, recentAdds, sent }
}

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: {
          Host: `localhost:${port}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          let json: any = null
          try { json = JSON.parse(raw) } catch { json = raw }
          resolve({ status: res.statusCode ?? 0, json })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const VALID_ID = '3b241101-e2bb-4255-8caf-4136c566a962'

describe('POST /api/sessions with a renderer-chosen id', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  async function start(opts: Parameters<typeof fakeDeps>[0] = {}) {
    const f = fakeDeps(opts)
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    return { port, ...f }
  }

  it('spawns under the given id at the given size and does not write a launch command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created, written } = await start()
    const res = await request(port, 'POST', '/api/sessions', {
      id: VALID_ID, path: dir, agentCli: 'claude', launchArgs: '--foo', size: { cols: 120, rows: 40 },
    })
    expect(res.status).toBe(200)
    expect(res.json.id).toBe(VALID_ID)
    expect(created).toHaveLength(1)
    expect(created[0].id).toBe(VALID_ID)
    expect(created[0].size).toEqual({ cols: 120, rows: 40 })
    expect(created[0].meta.launchArgs).toBe('--foo')
    // The renderer writes the launch command itself after create resolves.
    await new Promise((r) => setTimeout(r, 1100))
    expect(written).toHaveLength(0)
  })

  // The desktop window records the folder's args from this event. It must see
  // what was launched and main's current settings — its own copy can be stale.
  it('tells the desktop window the launched args and the current settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, sent } = await start({ settings: { claudeArgs: '--model opus' } })
    await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir, agentCli: 'claude', launchArgs: '--custom' })
    const ev = sent.find((e) => e.channel === 'remote:session-created')!.msg
    expect(ev.launchArgs).toBe('--custom')
    expect(ev.settingsArgs).toEqual({ claudeArgs: '--model opus', codexArgs: '', grokArgs: '', opencodeArgs: '' })
  })

  it('still launches server-side when no id is supplied (phone flow unchanged)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created, written } = await start()
    const res = await request(port, 'POST', '/api/sessions', { path: dir, agentCli: 'claude' })
    expect(res.status).toBe(200)
    expect(created).toHaveLength(1)
    expect(created[0].id).not.toBe(VALID_ID)
    await new Promise((r) => setTimeout(r, 1100))
    expect(written).toHaveLength(1)
    expect(written[0].id).toBe(created[0].id)
  })

  // A plain shell opened on the /desktop page arrived here with no way to say
  // so, was recorded as a Claude session, and the desktop window then stored
  // "claude" as that folder's agent over whatever the user had chosen.
  it('records a plain shell as a plain shell and says so to the desktop window', async () => {
    vi.mocked(trustFolder).mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created, sent } = await start()
    const res = await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir, isPlainShell: true })
    expect(res.status).toBe(200)
    expect(created[0].meta.isPlainShell).toBe(true)
    const evt = sent.find((s) => s.channel === 'remote:session-created')
    expect(evt?.msg.isPlainShell).toBe(true)
    // Trusting the folder is for launching Claude in it; a shell launches nothing.
    expect(trustFolder).not.toHaveBeenCalled()
  })

  it('does not mark an agent session as a plain shell', async () => {
    vi.mocked(trustFolder).mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created, sent } = await start()
    await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir, agentCli: 'claude', launchArgs: '' })
    expect(created[0].meta.isPlainShell).toBeUndefined()
    expect(sent.find((s) => s.channel === 'remote:session-created')?.msg.isPlainShell).toBe(false)
    expect(trustFolder).toHaveBeenCalledWith(dir)
  })

  // The phone has no shell button; the flag only means something on the
  // renderer-driven path, where the page (not the server) decides what to launch.
  it('ignores the flag on the phone path, which always launches an agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start()
    await request(port, 'POST', '/api/sessions', { path: dir, agentCli: 'codex', isPlainShell: true })
    expect(created[0].meta.isPlainShell).toBeUndefined()
  })

  it('rejects a non-UUID id with 400 and spawns nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start()
    const res = await request(port, 'POST', '/api/sessions', { id: 'not-a-uuid', path: dir })
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('id must be a UUID')
    expect(created).toHaveLength(0)
  })

  it('rejects an id already in use with 409 and spawns nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start({ existingIds: [VALID_ID] })
    const res = await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir })
    expect(res.status).toBe(409)
    expect(res.json.error).toBe(`Terminal "${VALID_ID}" already exists.`)
    expect(created).toHaveLength(0)
  })

  it('falls back to the default spawn size when size is garbage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start()
    await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir, size: { cols: -1, rows: 'x' } })
    expect(created[0].size).toEqual({ cols: 80, rows: 24 })
  })
})

describe('desktop-page support routes', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  async function start(opts: Parameters<typeof fakeDeps>[0] = {}) {
    const f = fakeDeps(opts)
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    return { port, ...f }
  }

  // The browser page has no folder picker; what is typed there is resolved
  // here, on the machine the folder is on, before anything is launched in it.
  it('GET /api/folders/resolve returns the stored spelling of a typed path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port } = await start()
    const plain = await request(port, 'GET', '/api/folders/resolve?path=' + encodeURIComponent(dir))
    expect(plain.status).toBe(200)
    const quoted = await request(port, 'GET', '/api/folders/resolve?path=' + encodeURIComponent(`"${dir}/"`))
    expect(quoted.status).toBe(200)
    expect(quoted.json.path).toBe(plain.json.path)
  })

  it('GET /api/folders/resolve explains why a path was refused', async () => {
    const { port } = await start()
    const missing = await request(port, 'GET', '/api/folders/resolve?path=' + encodeURIComponent(join(tmpdir(), 'cmdcld-does-not-exist')))
    expect(missing.status).toBe(400)
    expect(missing.json.error).toContain('cmdcld-does-not-exist')
    const none = await request(port, 'GET', '/api/folders/resolve')
    expect(none.status).toBe(400)
  })

  it('GET /api/status carries platform, home dir and build info', async () => {
    const { port } = await start()
    const res = await request(port, 'GET', '/api/status')
    expect(res.status).toBe(200)
    expect(['win32', 'darwin', 'linux']).toContain(res.json.platform)
    expect(typeof res.json.homeDir).toBe('string')
    expect(res.json.homeDir.length).toBeGreaterThan(0)
    expect(res.json.buildInfo).toMatchObject({ node: process.versions.node, platform: process.platform })
    expect(res.json.desktopClients).toBe(0)
  })

  it('GET /api/settings returns every setting plus cliAvailability', async () => {
    const { port } = await start({ settings: { defaultViewMode: 'focused', terminalFontSize: 13 } })
    const res = await request(port, 'GET', '/api/settings')
    expect(res.status).toBe(200)
    expect(res.json.defaultViewMode).toBe('focused')
    expect(res.json.terminalFontSize).toBe(13)
    expect(res.json.favoriteFolders).toEqual([])
    expect(res.json.cliAvailability).toBeTypeOf('object')
  })

  it('POST /api/settings writes a known key and rejects an unknown one', async () => {
    const { port, setCalls } = await start()
    const ok = await request(port, 'POST', '/api/settings', { key: 'defaultViewMode', value: 'focused' })
    expect(ok.status).toBe(200)
    expect(setCalls).toEqual([{ key: 'defaultViewMode', value: 'focused' }])
    const bad = await request(port, 'POST', '/api/settings', { key: '__proto__', value: 1 })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('unknown setting')
    expect(setCalls).toHaveLength(1)
  })

  it('POST /api/settings rejects a value whose type does not match the setting', async () => {
    const { port, setCalls } = await start()
    const cases: Array<[string, unknown]> = [
      ['favoriteFolders', 'not-an-array'],
      ['projectAgents', null],
      ['terminalFontSize', 'big'],
      ['terminalFontSize', Number.NaN],
      ['askBeforeLaunch', 'yes'],
      ['defaultViewMode', 42],
    ]
    for (const [key, value] of cases) {
      const res = await request(port, 'POST', '/api/settings', { key, value })
      expect(res.status, `${key}=${String(value)}`).toBe(400)
      expect(res.json.error, key).toBe('invalid value')
    }
    expect(setCalls).toHaveLength(0)
    const ok = await request(port, 'POST', '/api/settings', { key: 'favoriteFolders', value: ['/a'] })
    expect(ok.status).toBe(200)
    expect(setCalls).toEqual([{ key: 'favoriteFolders', value: ['/a'] }])
  })

  it('the Host/Origin gate covers the new routes too', async () => {
    const { port } = await start()
    const hostile = (path: string, method = 'GET') => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: 'evil.example.com' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    for (const [path, method] of [['/api/settings', 'POST'], ['/api/folders/check?path=/tmp', 'GET'], ['/api/git/status?path=/tmp', 'GET'], ['/desktop/', 'GET']] as const) {
      expect(await hostile(path, method), path).toBe(403)
    }
  })

  it('accepts this machine\'s own Tailscale name and rejects any other .ts.net site', async () => {
    const f = fakeDeps()
    const server = new RemoteServer({ ...f.deps, resolveTailscaleHost: async () => 'mine.tail1.ts.net.' })
    servers.push(server)
    const { port } = await server.start(0)
    await new Promise((r) => setTimeout(r, 20)) // the name is looked up asynchronously at start
    const status = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/status', headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    expect(await status({ Host: 'mine.tail1.ts.net' })).toBe(200)
    expect(await status({ Host: `localhost:${port}`, Origin: 'https://mine.tail1.ts.net' })).toBe(200)
    expect(await status({ Host: `localhost:${port}`, Origin: 'https://attacker.tail9.ts.net' })).toBe(403)
    expect(await status({ Host: 'attacker.tail9.ts.net' })).toBe(403)
  })

  it('trusts only the current Tailscale name after a rename', async () => {
    const f = fakeDeps()
    let current = 'old.tail1.ts.net'
    const server = new RemoteServer({ ...f.deps, resolveTailscaleHost: async () => current })
    servers.push(server)
    const { port } = await server.start(0)
    const status = (host: string) => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/status', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(await status('old.tail1.ts.net')).toBe(200)
    current = 'new.tail1.ts.net'
    ;(server as any).tailscaleLookupAt = 0 // skip the 10 s rate limit
    // Unknown name: the request waits for the re-read instead of being refused.
    expect(await status('new.tail1.ts.net')).toBe(200)
    expect(await status('old.tail1.ts.net')).toBe(403)
  })

  // CmdCLD starts at login, often before Tailscale is up, so the lookup at
  // start finds no name. The first page load from the phone was then answered
  // 403 — the request only *started* the re-read — and worked on a refresh.
  it('answers the first request once Tailscale has come up after start', async () => {
    const f = fakeDeps()
    let current: string | null = null
    const server = new RemoteServer({ ...f.deps, resolveTailscaleHost: async () => current })
    servers.push(server)
    const { port } = await server.start(0)
    await new Promise((r) => setTimeout(r, 20))
    current = 'mine.tail1.ts.net'
    ;(server as any).tailscaleLookupAt = 0 // as if 10 s had passed since start
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/status', headers: { Host: 'mine.tail1.ts.net' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    expect(status).toBe(200)
  })

  // Waiting on the lookup must not hand a stranger a way to make the server
  // run `tailscale status` per request, or to hang on one that never returns.
  it('still looks the name up at most once per window, however many unknown names ask', async () => {
    const f = fakeDeps()
    let lookups = 0
    const server = new RemoteServer({ ...f.deps, resolveTailscaleHost: async () => { lookups += 1; return 'mine.tail1.ts.net' } })
    servers.push(server)
    const { port } = await server.start(0)
    await new Promise((r) => setTimeout(r, 20))
    const status = (host: string) => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/status', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    for (let i = 0; i < 5; i++) expect(await status(`stranger${i}.tail9.ts.net`)).toBe(403)
    expect(lookups).toBe(1)
  })

  it('refuses rather than hangs when the lookup never returns', async () => {
    const f = fakeDeps()
    const server = new RemoteServer({ ...f.deps, resolveTailscaleHost: () => new Promise<string | null>(() => {}) })
    ;(server as any).tailscaleLookupTimeoutMs = 40
    servers.push(server)
    const { port } = await server.start(0)
    const started = Date.now()
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/status', headers: { Host: 'mine.tail1.ts.net' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    expect(status).toBe(403)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('POST /api/settings refuses the remote-access keys so a remote page cannot widen its own exposure', async () => {
    const { port, setCalls } = await start()
    for (const key of ['remoteAccess', 'remoteLanAccess', 'remotePort']) {
      const res = await request(port, 'POST', '/api/settings', { key, value: true })
      expect(res.status, key).toBe(403)
      expect(res.json.error, key).toBe('setting is not writable remotely')
    }
    expect(setCalls).toHaveLength(0)
  })

  it('POST /api/folders/recent adds an existing directory and rejects a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, recentAdds } = await start()
    const ok = await request(port, 'POST', '/api/folders/recent', { path: dir })
    expect(ok.status).toBe(200)
    expect(recentAdds).toEqual([dir])
    const bad = await request(port, 'POST', '/api/folders/recent', { path: join(dir, 'nope') })
    expect(bad.status).toBe(400)
    expect(recentAdds).toHaveLength(1)
  })

  it('GET /api/folders/check relays recentDB.checkPath', async () => {
    const { port } = await start()
    const ok = await request(port, 'GET', '/api/folders/check?path=' + encodeURIComponent('/tmp'))
    expect(ok.json).toEqual({ status: 'ok' })
    const missing = await request(port, 'GET', '/api/folders/check?path=' + encodeURIComponent('/nope'))
    expect(missing.json).toEqual({ status: 'missing' })
    const none = await request(port, 'GET', '/api/folders/check')
    expect(none.status).toBe(400)
  })

  it('GET /api/git/status reports a non-repo directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port } = await start()
    const res = await request(port, 'GET', '/api/git/status?path=' + encodeURIComponent(dir))
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ isRepo: false, branch: null, dirty: false, ahead: 0 })
    const none = await request(port, 'GET', '/api/git/status')
    expect(none.json).toMatchObject({ isRepo: false })
  })
})

// A tile closed from a browser (the /desktop grid, or Kill on the phone) used
// to stay in the desktop window: main killed the PTY and told only the socket
// clients. The dead tile took keystrokes nowhere, and minimising then restoring
// it found no PTY under its id and launched the agent again.
describe('DELETE /api/sessions/:id', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  it('tells the desktop window which session was closed', async () => {
    const id = '3f2b8c1e-5d47-4a9b-8e21-0c6f7a1d9b42'
    const f = fakeDeps({ existingIds: [id] })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const res = await request(port, 'DELETE', `/api/sessions/${id}`)
    expect(res.status).toBe(200)
    expect(f.sent).toContainEqual({ channel: 'remote:session-closed', msg: { id } })
  })

  it('says nothing for a session that does not exist', async () => {
    const f = fakeDeps()
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const res = await request(port, 'DELETE', '/api/sessions/nope')
    expect(res.status).toBe(404)
    expect(f.sent).toEqual([])
  })
})

describe('/desktop page serving', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  it('serves remote.html and its assets from the configured bundle dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-ui-'))
    writeFileSync(join(dir, 'remote.html'), '<!doctype html><title>R</title>')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'a.js'), 'console.log(1)')
    const f = fakeDeps({ desktopUiPath: dir })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const page = await request(port, 'GET', '/desktop/')
    expect(page.status).toBe(200)
    expect(String(page.json)).toContain('<title>R</title>')
    const asset = await request(port, 'GET', '/desktop/assets/a.js')
    expect(asset.status).toBe(200)
    // No trailing slash → redirect, so the page's relative asset URLs resolve under /desktop/.
    const bare = await request(port, 'GET', '/desktop')
    expect(bare.status).toBe(302)
  })

  // `send` refuses any path with a dot-directory in it unless the file is
  // named relative to a root. The app's own location is not ours to choose:
  // a Linux AppImage mounts at /tmp/.mount_CmdCLDxxxx, and a dev checkout can
  // live under .worktrees.
  it('serves the page when the bundle sits under a dot-directory', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cmdcld-ui-')), '.mount_CmdCLD', 'renderer')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'remote.html'), '<!doctype html><title>R</title>')
    const f = fakeDeps({ desktopUiPath: dir })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const page = await request(port, 'GET', '/desktop/')
    expect(page.status).toBe(200)
    expect(String(page.json)).toContain('<title>R</title>')
  })

  // page-select.js reads ?desktop / ?mobile on the page it lands on; a
  // redirect that drops the query sends a phone forcing the grid back to `/`.
  it('keeps the query string when adding the trailing slash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-ui-'))
    writeFileSync(join(dir, 'remote.html'), '<!doctype html><title>R</title>')
    const f = fakeDeps({ desktopUiPath: dir })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const location = (path: string) => new Promise<string | undefined>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path, headers: { Host: `localhost:${port}` } }, (res) => {
        res.resume()
        resolve(res.headers.location)
      }).on('error', reject)
    })
    expect(await location('/desktop?desktop')).toBe('/desktop/?desktop')
    expect(await location('/desktop?mobile&x=1')).toBe('/desktop/?mobile&x=1')
    expect(await location('/desktop')).toBe('/desktop/')
  })

  it('answers 503 with a build hint when the bundle is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-empty-'))
    const f = fakeDeps({ desktopUiPath: dir })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const page = await request(port, 'GET', '/desktop/')
    expect(page.status).toBe(503)
    expect(String(page.json)).toContain('npm run build')
  })
})
