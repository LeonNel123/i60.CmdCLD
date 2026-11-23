// Remembers that the person asked the app to quit (Cmd+Q, the Quit menu).
//
// Quitting closes every window, and a window with live terminals refuses its
// close while it shows the confirmation. Electron treats a refused close as a
// cancelled quit. So when a confirmed window finally closes, main checks this
// to decide whether to carry on quitting. The intent expires because a
// cancelled confirmation is not reported back to main.

export interface QuitIntent {
  request(): void
  active(): boolean
  clear(): void
}

export function createQuitIntent(opts: { now?: () => number; ttlMs?: number } = {}): QuitIntent {
  const now = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? 120_000
  let requestedAt: number | null = null
  return {
    request() { requestedAt = now() },
    active() { return requestedAt !== null && now() - requestedAt <= ttlMs },
    clear() { requestedAt = null },
  }
}
