import { describe, it, expect, afterEach } from 'vitest'
import http from 'http'
import { RemoteServer, normalizeSubmitText } from '../src/main/remote-server'

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

// Composed messages (mobile input bar, quick-action buttons) are normalised here
// before going to the queued writer, which appends the Enter as a delayed chunk.
// Internal newlines MUST survive as \\n: the server wraps the body in bracketed paste
// so a multi-paragraph prompt lands as one message. Converting them to \\r — what the
// client used to do — submits each line separately and splits the prompt into several
// messages in the agent console.
describe('normalizeSubmitText', () => {
  it('returns null when there is nothing to send', () => {
    expect(normalizeSubmitText('')).toBeNull()
    expect(normalizeSubmitText('   ')).toBeNull()
    expect(normalizeSubmitText('\n\n')).toBeNull()
  })

  it('keeps a multi-paragraph body as one block', () => {
    expect(normalizeSubmitText('para one\n\npara two')).toBe('para one\n\npara two')
  })

  it('normalises CRLF and lone CR to LF', () => {
    expect(normalizeSubmitText('a\r\nb')).toBe('a\nb')
    expect(normalizeSubmitText('a\rb')).toBe('a\nb')
  })

  it('trims surrounding whitespace without touching the interior', () => {
    expect(normalizeSubmitText('\n  hello\n\n')).toBe('hello')
    expect(normalizeSubmitText('  a\n  b  ')).toBe('a\n  b')
  })

  it('strips the trailing Enter carried by quick-action payloads', () => {
    expect(normalizeSubmitText('yes\r')).toBe('yes')
  })
})
