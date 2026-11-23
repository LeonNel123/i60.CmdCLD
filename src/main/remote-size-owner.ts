/**
 * Who owns PTY size: the desktop window, or one of the remote devices?
 *
 * A terminal has one size, and every client would like it to be its own: each
 * fits its xterm to its own tile and claims the PTY, "last fit wins". Left at
 * that, the desktop window wins every time — it never closes, and it adds a
 * tile for every session a remote client creates. The remote user then sees a
 * 33-column terminal in a 450 px tile.
 *
 * So one client owns the size and the rest mirror it. The owner is the device
 * **being used**: a click, a key, a tap, or a page brought to the front takes
 * the size (`take`), and whoever had it follows from then on. That is what
 * lets the desktop window and a phone be open side by side — each is right
 * while you are at it.
 *
 * It used to be "any connected remote owns it". A phone in a pocket and a
 * browser tab in the background both stayed connected, reconnected by
 * themselves after a restart, and kept the desktop window passive at whatever
 * size its terminals had been born with (80×24).
 *
 * A remote owner that leaves (`release`: disconnected, left its terminal,
 * turned Fit off) hands the size back to the desktop window after a grace
 * period: a browser reload is a disconnect followed by a reconnect within a
 * second, and announcing the desktop in between would have it resize every
 * PTY to its own layout and the browser resize them all back — two SIGWINCH
 * per agent per F5.
 */
export const LOCAL_OWNER = 'local'

export class RemoteSizeOwner {
  private owner: string = LOCAL_OWNER
  private pendingLocal: ReturnType<typeof setTimeout> | null = null
  private readonly announce: (owner: string) => void
  private readonly graceMs: number

  constructor(opts: { announce: (owner: string) => void; graceMs?: number }) {
    this.announce = opts.announce
    this.graceMs = opts.graceMs ?? 1500
  }

  /** `LOCAL_OWNER`, or the id of the remote client that owns the size. */
  get current(): string {
    return this.owner
  }

  get remote(): boolean {
    return this.owner !== LOCAL_OWNER
  }

  /** This client is being used: it sets the size from now on. */
  take(id: string): void {
    this.cancelPending()
    if (this.owner === id) return
    this.owner = id
    this.announce(id)
  }

  /** A remote client let go. Only the owner's letting go changes anything. */
  release(id: string): void {
    if (id === LOCAL_OWNER || this.owner !== id) return
    this.cancelPending()
    this.pendingLocal = setTimeout(() => {
      this.pendingLocal = null
      if (this.owner === id) {
        this.owner = LOCAL_OWNER
        this.announce(LOCAL_OWNER)
      }
    }, this.graceMs)
  }

  /** The server is stopping: every client is gone now, no grace. */
  reset(): void {
    this.cancelPending()
    if (this.owner !== LOCAL_OWNER) {
      this.owner = LOCAL_OWNER
      this.announce(LOCAL_OWNER)
    }
  }

  private cancelPending(): void {
    if (this.pendingLocal) { clearTimeout(this.pendingLocal); this.pendingLocal = null }
  }
}
