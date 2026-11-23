import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { RemoteServer } from '../src/main/remote-server'

// The server's socket wiring, driven through stand-ins for socket.io's server
// and sockets (the repo has no socket.io client to connect with). Everything
// asserted here is what RemoteServer itself decides: which room output goes
// to, who owns PTY size, and what the session list carries.

type Sent = { rooms: string[] | null; ev: string; msg: any }

class FakeSocket {
  handshake: { query: Record<string, string> }
  rooms = new Set<string>()
  sent: { ev: string; msg: any }[] = []
  private handlers = new Map<string, (payload: any) => void>()
  constructor(query: Record<string, string> = {}) { this.handshake = { query } }
  on(ev: string, fn: (payload: any) => void): void { this.handlers.set(ev, fn) }
  emit(ev: string, msg: any): void { this.sent.push({ ev, msg }) }
  join(room: string): void { this.rooms.add(room) }
  leave(room: string): void { this.rooms.delete(room) }
  /** A message arriving from the client. */
  receive(ev: string, payload?: any): void { this.handlers.get(ev)?.(payload) }
}

class FakeIo {
  sent: Sent[] = []
  private onConnection: ((socket: FakeSocket) => void) | null = null
  on(ev: string, fn: (socket: FakeSocket) => void): void { if (ev === 'connection') this.onConnection = fn }
  to(rooms: string | string[]) {
    const list = Array.isArray(rooms) ? rooms : [rooms]
    return { emit: (ev: string, msg: any) => { this.sent.push({ rooms: list, ev, msg }) } }
  }
  emit(ev: string, msg: any): void { this.sent.push({ rooms: null, ev, msg }) }
  close(): void {}
  connect(query: Record<string, string> = {}): FakeSocket {
    const socket = new FakeSocket(query)
    this.onConnection?.(socket)
    return socket
  }
  of(ev: string): Sent[] { return this.sent.filter((s) => s.ev === ev) }
}

function setup() {
  const pty = Object.assign(new EventEmitter(), {
    sessions: [{ id: 'a', path: 'D:\\proj', name: 'proj', color: '' }] as any[],
    listAll() { return this.sessions },
    has: (id: string) => id === 'a' || id === 'b',
    resize() {},
    write() {},
  })
  const windowMessages: any[] = []
  const wc = { isDestroyed: () => false, send: (_ch: string, msg: unknown) => { windowMessages.push(msg) } } as any
  const server = new RemoteServer({
    ptyManager: pty as any,
    settings: { get: () => '' } as any,
    recentDB: {} as any,
    getWebContents: () => wc,
  })
  const io = new FakeIo()
  ;(server as any).io = io
  ;(server as any).setupSocketEvents()
  ;(server as any).setupPtyListeners()
  return { server, pty, io, windowMessages }
}

/** Output every 200 ms for `ms` milliseconds. */
function work(pty: EventEmitter, id: string, ms: number): void {
  for (let t = 0; t <= ms; t += 200) {
    pty.emit('data', { id, data: 'x' })
    if (t < ms) vi.advanceTimersByTime(200)
  }
}

describe('remote server — phone clients', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    ctx = setup()
  })
  afterEach(() => {
    ;(ctx.server as any).cleanup()
    vi.useRealTimers()
  })

  // Every session's output used to go to every client. A phone on the session
  // list was paying mobile data for terminals it was not showing.
  describe('output routing', () => {
    it('sends output only to the session room and the all-output room', () => {
      ctx.pty.emit('data', { id: 'a', data: 'hello' })
      expect(ctx.io.of('session:output')).toEqual([
        { rooms: ['output*', 'output:a'], ev: 'session:output', msg: { id: 'a', data: 'hello' } },
      ])
    })

    it('puts the /desktop page in the all-output room and leaves the phone out', () => {
      expect([...ctx.io.connect({ client: 'desktop' }).rooms]).toEqual(['output*'])
      expect([...ctx.io.connect().rooms]).toEqual([])
    })

    it('lets a phone watch one session at a time', () => {
      const phone = ctx.io.connect()
      phone.receive('session:watch', { id: 'a' })
      expect([...phone.rooms]).toEqual(['output:a'])
      phone.receive('session:watch', { id: 'b' })
      expect([...phone.rooms]).toEqual(['output:b'])
      phone.receive('session:watch', { id: null })
      expect([...phone.rooms]).toEqual([])
    })

    it('ignores a watch request that names no session', () => {
      const phone = ctx.io.connect()
      phone.receive('session:watch', { id: { $ne: 1 } })
      phone.receive('session:watch', undefined)
      phone.receive('session:watch', { id: 'all' })
      expect([...phone.rooms]).toEqual([])
    })
  })

  describe('activity', () => {
    it('announces when a session starts working and when it goes idle', () => {
      work(ctx.pty, 'a', 1200)
      expect(ctx.io.of('session:activity')).toEqual([
        { rooms: null, ev: 'session:activity', msg: { id: 'a', busy: true, ageMs: 1000 } },
      ])
      vi.advanceTimersByTime(2000)
      expect(ctx.io.of('session:activity')[1].msg).toEqual({ id: 'a', busy: false, ageMs: 2000 })
    })

    it('includes each session\'s activity in the list a new client receives', () => {
      work(ctx.pty, 'a', 1200)
      vi.advanceTimersByTime(2000 + 60_000)
      const phone = ctx.io.connect()
      expect(phone.sent[0]).toEqual({
        ev: 'sessions:changed',
        msg: [{ id: 'a', path: 'D:\\proj', name: 'proj', color: '', busy: false, ageMs: 62_000 }],
      })
    })

    it('stops tracking a session that exited', () => {
      work(ctx.pty, 'a', 1200)
      ctx.pty.emit('exit', { id: 'a', exitCode: 0 })
      vi.advanceTimersByTime(10_000)
      expect(ctx.io.of('session:activity')).toHaveLength(1)
    })

    it('stops tracking a session that was closed', () => {
      work(ctx.pty, 'a', 1200)
      ctx.pty.emit('killed', { id: 'a' })
      vi.advanceTimersByTime(10_000)
      expect(ctx.io.of('session:activity')).toHaveLength(1)
    })

    it('leaves no timers behind when the server stops', () => {
      work(ctx.pty, 'a', 1200)
      ;(ctx.server as any).cleanup()
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('settings', () => {
    it('tells every browser client when settings changed', () => {
      ctx.server.notifySettingsChanged(['claudeArgs', 'favoriteFolders'])
      expect(ctx.io.of('settings:changed')).toEqual([
        { rooms: null, ev: 'settings:changed', msg: { keys: ['claudeArgs', 'favoriteFolders'] } },
      ])
    })

    it('says nothing while the server is not running', () => {
      ;(ctx.server as any).io = null
      expect(() => ctx.server.notifySettingsChanged(['claudeArgs'])).not.toThrow()
    })
  })

  // One terminal has one size, so one device sets it — the one being used —
  // and the rest mirror it. Being connected is not being used.
  describe('size ownership', () => {
    const told = (s: FakeSocket) => s.sent.filter((m) => m.ev === 'size:owner').map((m) => m.msg.you)

    it('leaves the desktop window in charge while remote devices are only connected', () => {
      ctx.io.connect({ client: 'desktop' })
      ctx.io.connect()
      expect(ctx.windowMessages).toEqual([])
      expect(ctx.server.remoteOwnsSize()).toBe(false)
    })

    it('makes the desktop window passive when the /desktop page is used', () => {
      const page = ctx.io.connect({ client: 'desktop' })
      page.receive('size:take')
      expect(ctx.windowMessages).toEqual([{ remote: true }])
      expect(ctx.server.remoteOwnsSize()).toBe(true)
      expect(told(page)).toEqual([true])
    })

    it('makes the desktop window passive while a phone fits a terminal to its screen', () => {
      const phone = ctx.io.connect()
      phone.receive('size:claim', { on: true })
      expect(ctx.windowMessages).toEqual([{ remote: true }])
      expect(told(phone)).toEqual([true])
    })

    it('gives the size back the moment the desktop window is used, and tells the device that had it', () => {
      const phone = ctx.io.connect()
      phone.receive('size:claim', { on: true })
      ctx.server.takeLocalSize()
      expect(ctx.windowMessages).toEqual([{ remote: true }, { remote: false }])
      expect(ctx.server.remoteOwnsSize()).toBe(false)
      expect(told(phone)).toEqual([true, false])
    })

    it('lets the phone take it again by claiming again', () => {
      const phone = ctx.io.connect()
      phone.receive('size:claim', { on: true })
      ctx.server.takeLocalSize()
      phone.receive('size:claim', { on: true })
      expect(ctx.windowMessages).toEqual([{ remote: true }, { remote: false }, { remote: true }])
      expect(told(phone)).toEqual([true, false, true])
    })

    it('moves the size between two remote devices and tells each where it stands', () => {
      const page = ctx.io.connect({ client: 'desktop' })
      const phone = ctx.io.connect()
      page.receive('size:take')
      phone.receive('size:claim', { on: true })
      expect(told(page)).toEqual([true, false])
      expect(told(phone)).toEqual([false, true])
      expect(ctx.server.remoteOwnsSize()).toBe(true)
    })

    it('hands the size back after the grace period when the phone lets go', () => {
      const phone = ctx.io.connect()
      phone.receive('size:claim', { on: true })
      phone.receive('size:claim', { on: false })
      expect(ctx.windowMessages).toEqual([{ remote: true }])
      vi.advanceTimersByTime(1500)
      expect(ctx.windowMessages).toEqual([{ remote: true }, { remote: false }])
    })

    it('hands the size back when the device that owns it disconnects', () => {
      const page = ctx.io.connect({ client: 'desktop' })
      page.receive('size:take')
      page.receive('disconnect')
      vi.advanceTimersByTime(1500)
      expect(ctx.windowMessages).toEqual([{ remote: true }, { remote: false }])
    })

    it('does nothing when a device that does not own the size lets go or disconnects', () => {
      const page = ctx.io.connect({ client: 'desktop' })
      const phone = ctx.io.connect()
      page.receive('size:take')
      phone.receive('size:claim', { on: false })
      phone.receive('disconnect')
      vi.advanceTimersByTime(5000)
      expect(ctx.windowMessages).toEqual([{ remote: true }])
      expect(ctx.server.remoteOwnsSize()).toBe(true)
    })

    it('stops telling a device that has disconnected', () => {
      const phone = ctx.io.connect()
      const page = ctx.io.connect({ client: 'desktop' })
      phone.receive('disconnect')
      page.receive('size:take')
      expect(told(phone)).toEqual([])
    })
  })
})
