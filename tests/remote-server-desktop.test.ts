import { describe, it, expect, afterEach } from 'vitest'
import http from 'http'
import { tmpdir } from 'os'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RemoteServer } from '../src/main/remote-server'

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
    getWebContents: () => ({ isDestroyed: () => false, send() {} }) as any,
    desktopUiPath: opts.desktopUiPath,
  }
  return { deps, created, written, setCalls, recentAdds }
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

  it('GET /api/status carries platform, home dir and build info', async () => {
    const { port } = await start()
    const res = await request(port, 'GET', '/api/status')
    expect(res.status).toBe(200)
    expect(['win32', 'darwin', 'linux']).toContain(res.json.platform)
    expect(typeof res.json.homeDir).toBe('string')
    expect(res.json.homeDir.length).toBeGreaterThan(0)
    expect(res.json.buildInfo).toMatchObject({ node: process.versions.node, platform: process.platform })
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
