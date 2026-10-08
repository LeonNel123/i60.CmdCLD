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

  // Partial so every member is contextually typed (no implicit any on the
  // arrow parameters). Task 5 fills in the remaining members and drops Partial.
  const api: Partial<ElectronAPI> & { remote: true } = {
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
  }

  return api as ElectronAPI & { remote: true }
}
