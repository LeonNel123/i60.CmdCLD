import { describe, it, expect } from 'vitest'
import { createRemoteApi, type SocketLike, type RemoteStatus } from '../src/renderer/src/remote/remote-api'

class FakeSocket implements SocketLike {
  connected = true
  handlers = new Map<string, Array<(...a: any[]) => void>>()
  emitted: Array<{ event: string; payload: unknown }> = []
  on(event: string, cb: (...a: any[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb])
  }
  off(event: string, cb: (...a: any[]) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb))
  }
  emit(event: string, payload: unknown) { this.emitted.push({ event, payload }) }
  // Test helper: simulate a server→client event.
  receive(event: string, payload: unknown) { for (const h of this.handlers.get(event) ?? []) h(payload) }
}

const status: RemoteStatus = {
  platform: 'darwin', homeDir: '/Users/me', version: '1.6.37',
  buildInfo: { electron: '42', chrome: '1', node: '24', platform: 'darwin', release: '25' },
}

function make(fetchImpl?: (path: string, init?: RequestInit) => Promise<unknown>) {
  const socket = new FakeSocket()
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init })
    return (fetchImpl ? await fetchImpl(path, init) : {}) as T
  }
  const api = createRemoteApi({
    socket, fetchJson, status,
    promptForPath: async () => '/picked',
    copyText: () => true,
  })
  return { api, socket, calls }
}

describe('createRemoteApi — socket fan-out', () => {
  it('routes output only to the subscriber for that id', () => {
    const { api, socket } = make()
    const a: string[] = []; const b: string[] = []
    api.onTerminalData('a', (d) => a.push(d))
    api.onTerminalData('b', (d) => b.push(d))
    socket.receive('session:output', { id: 'a', data: 'hello' })
    expect(a).toEqual(['hello'])
    expect(b).toEqual([])
  })

  it('stops delivering after unsubscribe', () => {
    const { api, socket } = make()
    const seen: string[] = []
    const unsub = api.onTerminalData('a', (d) => seen.push(d))
    socket.receive('session:output', { id: 'a', data: '1' })
    unsub()
    socket.receive('session:output', { id: 'a', data: '2' })
    expect(seen).toEqual(['1'])
  })

  it('delivers exit codes and resizes per id', () => {
    const { api, socket } = make()
    const exits: number[] = []; const sizes: Array<{ cols: number; rows: number }> = []
    api.onTerminalExit('x', (c) => exits.push(c))
    api.onTerminalResize('x', (s) => sizes.push(s))
    api.onTerminalExit('y', () => exits.push(-1))
    socket.receive('session:exit', { id: 'x', exitCode: 3 })
    socket.receive('session:resize', { id: 'x', cols: 100, rows: 30 })
    expect(exits).toEqual([3])
    expect(sizes).toEqual([{ cols: 100, rows: 30 }])
  })
})

describe('createRemoteApi — terminal calls', () => {
  it('createTerminal posts id, path, agentCli, launchArgs and size', async () => {
    const { api, calls } = make(async () => ({ id: 'id1', name: 'p', path: '/p' }))
    await api.createTerminal('id1', '/p', 'codex', '--x', false, { cols: 90, rows: 20 })
    expect(calls[0].path).toBe('/api/sessions')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      id: 'id1', path: '/p', agentCli: 'codex', launchArgs: '--x', size: { cols: 90, rows: 20 },
    })
  })

  it('createTerminal rejects with the server message on failure', async () => {
    const { api } = make(async () => { throw new Error('Terminal "id1" already exists.') })
    await expect(api.createTerminal('id1', '/p')).rejects.toThrow('already exists')
  })

  it('writeTerminal and resizeTerminal emit socket events', async () => {
    const { api, socket } = make()
    await api.writeTerminal('t', 'ls\r')
    await api.resizeTerminal('t', 120, 40)
    expect(socket.emitted).toEqual([
      { event: 'session:input', payload: { id: 't', data: 'ls\r' } },
      { event: 'session:resize', payload: { id: 't', cols: 120, rows: 40 } },
    ])
  })

  it('killTerminal, getScrollback, terminalExists, terminalListLive map to REST', async () => {
    const sessions = [{ id: 't', path: '/p', name: 'p', color: '' }]
    const { api, calls } = make(async (path) => {
      if (path === '/api/sessions') return sessions
      if (path.endsWith('/scrollback')) return { scrollback: 'SB', cols: 80, rows: 24 }
      return { ok: true }
    })
    await api.killTerminal('t')
    expect(calls[0]).toMatchObject({ path: '/api/sessions/t', init: { method: 'DELETE' } })
    expect(await api.getScrollback('t')).toBe('SB')
    expect(await api.terminalExists('t')).toBe(true)
    expect(await api.terminalExists('zz')).toBe(false)
    expect(await api.terminalListLive()).toEqual(sessions)
  })
})
