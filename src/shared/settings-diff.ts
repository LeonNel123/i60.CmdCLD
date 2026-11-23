// What the settings dialog should write on Save: the keys whose value differs
// from what it loaded when it opened. Writing every key would put back the
// old value of anything changed elsewhere in the meantime.

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export function changedSettings(
  loaded: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    if (!loaded || !sameValue(loaded[key], value)) changed[key] = value
  }
  return changed
}
