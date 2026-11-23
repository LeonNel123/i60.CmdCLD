// Remembers the result of a slow synchronous lookup for a while. For probes
// that shell out on the main thread (where, vswhere) and whose answer only
// changes when something is installed or removed.

export interface Cached<T> {
  (): T
  /** Recompute now and return the new value. */
  refresh(): T
}

export function cachedFor<T>(compute: () => T, ttlMs: number, now: () => number = Date.now): Cached<T> {
  let entry: { value: T; at: number } | null = null
  const refresh = (): T => {
    const value = compute()
    entry = { value, at: now() }
    return value
  }
  const get = (): T => (entry && now() - entry.at <= ttlMs ? entry.value : refresh())
  return Object.assign(get, { refresh })
}
