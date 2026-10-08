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
 */
export type SizeOwner = 'remote' | 'local'

export class RemoteSizeOwner {
  private desktopClients = 0

  get count(): number {
    return this.desktopClients
  }

  /** Returns the new owner when ownership changed, else null. */
  connect(isDesktopClient: boolean): SizeOwner | null {
    if (!isDesktopClient) return null
    this.desktopClients += 1
    return this.desktopClients === 1 ? 'remote' : null
  }

  /** Returns the new owner when ownership changed, else null. */
  disconnect(isDesktopClient: boolean): SizeOwner | null {
    if (!isDesktopClient || this.desktopClients === 0) return null
    this.desktopClients -= 1
    return this.desktopClients === 0 ? 'local' : null
  }
}
