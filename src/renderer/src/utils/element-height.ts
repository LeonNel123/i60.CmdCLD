/**
 * Watches an element's height and reports it as it changes.
 *
 * Handed to React as a *ref callback* rather than wired up by an effect. The
 * element this tracks — the terminal grid area — is not in the tree during the
 * first render: App shows a loading screen until saved state arrives. An effect
 * with [] deps therefore ran once against a null ref, bailed, and never ran
 * again, so nothing was ever observed and the grid kept sizing itself off its
 * startup guess (window.innerHeight). That reads as tiles running on underneath
 * the broadcast bar and the taskbar, since those take real space the grid box
 * gives up but the tiles never gave back. A ref callback fires whenever the node
 * attaches, whichever render that turns out to be.
 *
 * A zero height is ignored: that is what a box reports before layout or while
 * hidden, and acting on it would collapse the grid.
 */
export function createHeightTracker(
  onHeight: (height: number) => void,
): (el: HTMLElement | null) => void {
  let observer: ResizeObserver | null = null

  return (el) => {
    observer?.disconnect()
    observer = null
    if (!el) return

    const measure = (): void => {
      const h = el.getBoundingClientRect().height
      if (h > 0) onHeight(h)
    }

    measure()
    observer = new ResizeObserver(measure)
    observer.observe(el)
  }
}
