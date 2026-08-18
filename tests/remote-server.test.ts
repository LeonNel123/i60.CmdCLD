import { describe, it, expect, afterEach } from 'vitest'
import http from 'http'
import { RemoteServer } from '../src/main/remote-server'

function fakeDeps(settingsOverrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    remoteLanAccess: false,
    claudeArgs: '',
    codexArgs: '',
    favoriteFolders: [],
    ...settingsOverrides,
  }
  return {
    ptyManager: { on() {}, off() {}, listAll() { return [] } } as any,
    settings: { get: (k: string) => values[k] } as any,
    recentDB: { list: async () => [], add: async () => {}, remove: async () => {} } as any,
    getWebContents: () => null,
  }
}

function getStatus(port: number, hostHeader: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/status',
        headers: { Host: hostHeader, ...(origin ? { Origin: origin } : {}) },
      },
      (res) => { res.resume(); resolve(res.statusCode ?? 0) },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('RemoteServer request gating', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  function make(overrides: Record<string, unknown> = {}): RemoteServer {
    const s = new RemoteServer(fakeDeps(overrides))
    servers.push(s)
    return s
  }

  it('accepts a localhost Host and rejects a foreign Host with 403', async () => {
    const server = make()
    const { port } = await server.start(0)
    expect(port).toBeGreaterThan(0)
    expect(await getStatus(port, `localhost:${port}`)).toBe(200)
    expect(await getStatus(port, 'evil.example.com')).toBe(403)
  })

  it('rejects a hostile Origin even with a good Host', async () => {
    const server = make()
    const { port } = await server.start(0)
    expect(await getStatus(port, `localhost:${port}`, 'https://evil.example.com')).toBe(403)
    expect(await getStatus(port, `localhost:${port}`, `http://localhost:${port}`)).toBe(200)
  })

  it('reports only the localhost URL when LAN mode is off', async () => {
    const server = make()
    const { port, urls } = await server.start(0)
    expect(urls).toEqual([`http://localhost:${port}`])
  })

  it('rejects start() on an occupied port at bind time', async () => {
    const server = make()
    const { port } = await server.start(0)
    const second = make()
    await expect(second.start(port)).rejects.toThrow()
  })
})
