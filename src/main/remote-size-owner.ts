/**
 * Who owns PTY size: the desktop window, or a browser running the desktop
 * layout page (/desktop)?
 *
 * Every client fits its xterm to its own tile and claims the PTY size, "last
 * fit wins". That is fine between two devices used one at a time — except the
 * desktop window is never closed: it hosts the server, and it adds a tile for
 * every session a remote client creates, fits it to its own layout, and wins.
 * The remote user then sees a 33-column terminal in a 450 px tile.
 *
 * So while at least one /desktop browser client is connected, the desktop
 * window goes passive: it mirrors PTY sizes instead of claiming them. Phone
 * clients (the single-terminal UI) never take ownership.
 *
 * Handing ownership back waits a grace period: a browser reload is a
 * disconnect followed by a reconnect within a second, and announcing `local`
 * in between would have the desktop resize every PTY to its own layout and
 * the browser resize them all back — two SIGWINCH per agent per F5.
 */
export type SizeOwner = 'remote' | 'local'

export class RemoteSizeOwner {
  private desktopClients = 0
  private owner: SizeOwner = 'local'
  private pendingLocal: ReturnType<typeof setTimeout> | null = null
  private readonly announce: (owner: SizeOwner) => void
  private readonly graceMs: number

  constructor(opts: { announce: (owner: SizeOwner) => void; graceMs?: number }) {
    this.announce = opts.announce
    this.graceMs = opts.graceMs ?? 1500
  }

  get count(): number {
    return this.desktopClients
  }

  connect(isDesktopClient: boolean): void {
    if (!isDesktopClient) return
    this.desktopClients += 1
    this.cancelPending()
    if (this.owner !== 'remote') {
      this.owner = 'remote'
      this.announce('remote')
    }
  }

  disconnect(isDesktopClient: boolean): void {
    if (!isDesktopClient || this.desktopClients === 0) return
    this.desktopClients -= 1
    if (this.desktopClients > 0 || this.owner !== 'remote') return
    this.cancelPending()
    this.pendingLocal = setTimeout(() => {
      this.pendingLocal = null
      if (this.desktopClients === 0 && this.owner === 'remote') {
        this.owner = 'local'
        this.announce('local')
      }
    }, this.graceMs)
  }

  /** The server is stopping: every client is gone now, no grace. */
  reset(): void {
    this.cancelPending()
    this.desktopClients = 0
    if (this.owner === 'remote') {
      this.owner = 'local'
      this.announce('local')
    }
  }

  private cancelPending(): void {
    if (this.pendingLocal) { clearTimeout(this.pendingLocal); this.pendingLocal = null }
  }
}
