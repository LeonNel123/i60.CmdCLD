/**
 * When a page takes PTY size without being asked (see
 * src/main/remote-size-owner.ts for the rule: the device being used owns it).
 *
 * A click, a key or the page coming to the front is use, and App.tsx sends
 * those as they happen. Loading is use only when someone opened the page: the
 * /desktop page also reloads by itself when its socket reconnects — after the
 * app restarts, say — and a page reloading on a phone left on the desk, or in
 * a background tab, must not take the terminals from the person at the PC.
 */
export function takesSizeOnLoad(state: { visible: boolean; focused: boolean; autoReloaded: boolean }): boolean {
  return state.visible && state.focused && !state.autoReloaded
}

const AUTO_RELOAD_KEY = 'cmdcld-auto-reloaded'

type MarkerStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Called just before the page reloads itself; survives exactly that reload. */
export function markAutoReload(store: Pick<MarkerStore, 'setItem'> | undefined): void {
  try { store?.setItem(AUTO_RELOAD_KEY, '1') } catch {}
}

/** Whether this load is that reload. Reads the marker once and removes it. */
export function consumeAutoReload(store: Pick<MarkerStore, 'getItem' | 'removeItem'> | undefined): boolean {
  try {
    if (!store || store.getItem(AUTO_RELOAD_KEY) !== '1') return false
    store.removeItem(AUTO_RELOAD_KEY)
    return true
  } catch {
    return false
  }
}
