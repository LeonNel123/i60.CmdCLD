// Ends whatever autopilot run is attached to a terminal. Called from the
// Stop button and — the part that was missing — whenever the terminal itself
// goes away, so a run can never outlive the PTY it drives.

export interface StoppableRun {
  stop: () => void
}

/** Stops and forgets every run keyed by `terminalId`. Returns how many. */
export function stopRunsForTerminal(
  terminalId: string,
  registries: ReadonlyArray<Map<string, StoppableRun>>,
  onError: (error: unknown) => void = () => {},
): number {
  let stopped = 0
  for (const registry of registries) {
    const run = registry.get(terminalId)
    if (!run) continue
    // Out of the map first: stop() may kill a PTY, which calls back in here.
    registry.delete(terminalId)
    stopped++
    try {
      run.stop()
    } catch (e) {
      onError(e)
    }
  }
  return stopped
}
