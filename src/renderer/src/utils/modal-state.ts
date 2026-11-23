// Whether a modal dialog is covering the terminals. A dialog does not take
// keyboard focus by being drawn: the terminal behind it keeps it, so Escape
// and Enter meant for the dialog were typed into the agent instead
// (interrupting it, or submitting its prompt). App.tsx sets this; every
// terminal's key handler reads it and declines all keys while it is set.

let openCount = 0

/** Marks one modal as open; call the returned function when it closes. */
export function markModalOpen(): () => void {
  openCount++
  let released = false
  return () => {
    if (released) return
    released = true
    openCount--
  }
}

export function isModalOpen(): boolean {
  return openCount > 0
}
