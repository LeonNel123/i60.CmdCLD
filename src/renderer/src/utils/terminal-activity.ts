// Tracks busy/idle state per terminal by watching PTY data flow.
// Busy = data received recently. Idle = no data for IDLE_TIMEOUT ms.

const IDLE_TIMEOUT = 2000

type Listener = (id: string, busy: boolean) => void

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const states = new Map<string, boolean>() // true = busy
const listeners = new Set<Listener>()

function notify(id: string, busy: boolean): void {
  const prev = states.get(id)
  if (prev === busy) return
  states.set(id, busy)
  for (const fn of listeners) fn(id, busy)
}

/** Call this every time PTY data arrives for a terminal */
export function onTerminalDataReceived(id: string): void {
  notify(id, true)

  // Reset idle timer
  const existing = timers.get(id)
  if (existing) clearTimeout(existing)
  timers.set(id, setTimeout(() => {
    notify(id, false)
  }, IDLE_TIMEOUT))
}

/** Clean up when a terminal is removed */
export function removeTerminalActivity(id: string): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  states.delete(id)
}

/** Subscribe to busy/idle changes. Returns unsubscribe function. */
export function onActivityChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Get current state for a terminal */
export function isBusy(id: string): boolean {
  return states.get(id) ?? false
}
