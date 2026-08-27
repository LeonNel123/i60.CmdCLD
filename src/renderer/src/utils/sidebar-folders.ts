// Splits the sidebar's folder rows into the FAVORITES and RECENTS sections.
//
// The two lists have different sources on purpose:
//
//   * RECENTS is the recent-folders table — a rolling window capped at 20
//     entries, newest first.
//   * FAVORITES is `favoriteFolders` in settings — an explicit, unbounded
//     pin list.
//
// Sourcing the favorites section from the recents table (as this did before)
// coupled the two: a favorite the user hadn't opened lately fell out of the
// 20-entry window and silently disappeared from the sidebar. Someone with 20
// favorites saw only the handful that were still recent. Favorites are
// therefore built from the pin list, and any path the recents table no longer
// carries gets a synthesized row (`lastOpened: 0` — the field is not
// rendered, only used to order the recents section).
//
// Open projects are excluded from both: they live in the ACTIVE section
// above, and "move back" here when their terminals close.

// How many rows the RECENTS section draws. The table behind it holds
// RECENT_LIMIT (50) so that a long favorites list can't evict genuine recents,
// but 50 rows is more sidebar than anyone scrolls — show the newest slice.
// FAVORITES is deliberately uncapped: every entry there is an explicit pin,
// and silently hiding one is the bug this module was extracted to fix.
export const RECENT_DISPLAY_LIMIT = 15

export interface SidebarFolder {
  path: string
  name: string
  lastOpened: number
}

export function folderNameFromPath(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

export function partitionSidebarFolders(
  recentFolders: readonly SidebarFolder[],
  favoriteFolders: readonly string[],
  activePaths: ReadonlySet<string>
): { favorites: SidebarFolder[]; recents: SidebarFolder[] } {
  const favSet = new Set(favoriteFolders)
  const byPath = new Map(recentFolders.map((f) => [f.path, f]))

  const favorites = [...new Set(favoriteFolders)]
    .filter((p) => !activePaths.has(p))
    .map((p) => byPath.get(p) ?? { path: p, name: folderNameFromPath(p), lastOpened: 0 })
    .sort((a, b) => a.name.localeCompare(b.name))

  const recents = recentFolders
    .filter((f) => !activePaths.has(f.path) && !favSet.has(f.path))
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, RECENT_DISPLAY_LIMIT)

  return { favorites, recents }
}
