/**
 * Telling clients that settings changed.
 *
 * Settings live in main, but the desktop window and every /desktop browser
 * tab keep their own copy, loaded once. Nothing told one when another wrote:
 * a tab left open kept launching with flags that had been removed on the PC,
 * and either side could write back a stale `favoriteFolders` or
 * `projectAgents` over the other's change.
 *
 * Clients reload everything on a notice, so writes are coalesced — saving the
 * settings dialog is about thirty writes in a row and should be one reload.
 */
export interface SettingsBroadcast {
  /** A setting was written. */
  changed(key: string): void
  dispose(): void
}

export function createSettingsBroadcast(opts: {
  notify: (keys: string[]) => void
  delayMs?: number
}): SettingsBroadcast {
  const delayMs = opts.delayMs ?? 50
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    changed(key: string): void {
      pending.add(key)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const keys = [...pending]
        pending = new Set()
        opts.notify(keys)
      }, delayMs)
    },
    dispose(): void {
      if (timer) { clearTimeout(timer); timer = null }
      pending = new Set()
    },
  }
}
