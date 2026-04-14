import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))

vi.mock('child_process', () => ({ execFile: execFileMock }))

async function loadModule() {
  vi.resetModules()
  return await import('../src/main/tailscale')
}

function mockExec(responses: Array<{ match: (args: string[]) => boolean; stdout?: string; stderr?: string; code?: string }>) {
  execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    for (const r of responses) {
      if (r.match(args)) {
        if (r.code) {
          const err = new Error('exec error') as Error & { code?: string; stderr?: string }
          err.code = r.code
          err.stderr = r.stderr
          return cb(err)
        }
        if (r.stderr) {
          const err = new Error(r.stderr) as Error & { stderr?: string }
          err.stderr = r.stderr
          return cb(err)
        }
        return cb(null, { stdout: r.stdout || '', stderr: '' })
      }
    }
    cb(new Error('no mock match for ' + args.join(' ')))
  })
}

beforeEach(() => {
  execFileMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tailscale.getStatus', () => {
  it('reports not-installed when execFile fails with ENOENT', async () => {
    mockExec([{ match: () => true, code: 'ENOENT' }])
    const { getStatus } = await loadModule()
    const s = await getStatus()
    expect(s.installed).toBe(false)
    expect(s.error).toMatch(/not found/i)
  })

  it('reports NeedsLogin as installed-but-not-signed-in', async () => {
    mockExec([{ match: (a) => a[0] === 'status', stdout: JSON.stringify({ BackendState: 'NeedsLogin' }) }])
    const { getStatus } = await loadModule()
    const s = await getStatus()
    expect(s.installed).toBe(true)
    expect(s.loggedIn).toBe(false)
    expect(s.error).toMatch(/not signed in/i)
  })

  it('parses a running tailnet with HTTPS + MagicDNS', async () => {
    mockExec([{
      match: (a) => a[0] === 'status',
      stdout: JSON.stringify({
        BackendState: 'Running',
        Self: { DNSName: 'my-pc.tailnet-xyz.ts.net.', Online: true },
        CurrentTailnet: { MagicDNSSuffix: 'tailnet-xyz.ts.net' },
        CertDomains: ['my-pc.tailnet-xyz.ts.net'],
      }),
    }])
    const { getStatus } = await loadModule()
    const s = await getStatus()
    expect(s.loggedIn).toBe(true)
    expect(s.online).toBe(true)
    expect(s.httpsEnabled).toBe(true)
    expect(s.httpsHost).toBe('my-pc.tailnet-xyz.ts.net')
  })
})

describe('tailscale.startServe', () => {
  it('returns the tailscale HTTPS url on success', async () => {
    mockExec([
      { match: (a) => a[0] === 'serve' && a[1] === '--bg', stdout: '' },
      { match: (a) => a[0] === 'serve' && a[1] === 'status', stdout: JSON.stringify({ Web: { 'my-pc.t.ts.net:443': { Handlers: {} } } }) },
    ])
    const { startServe } = await loadModule()
    const r = await startServe(3456)
    expect(r.ok).toBe(true)
    expect(r.url).toBe('https://my-pc.t.ts.net')
  })

  it('surfaces stderr when tailscale rejects', async () => {
    mockExec([
      { match: (a) => a[0] === 'serve' && a[1] === '--bg', stderr: 'HTTPS is not enabled on this tailnet' },
    ])
    const { startServe } = await loadModule()
    const r = await startServe(3456)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/HTTPS is not enabled/)
  })
})
