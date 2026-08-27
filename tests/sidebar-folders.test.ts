import { describe, it, expect } from 'vitest'
import {
  partitionSidebarFolders,
  folderNameFromPath,
  RECENT_DISPLAY_LIMIT,
} from '../src/renderer/src/utils/sidebar-folders'

const f = (path: string, lastOpened: number) => ({
  path,
  name: folderNameFromPath(path),
  lastOpened,
})

describe('partitionSidebarFolders', () => {
  it('splits recents from favorites', () => {
    const recent = [f('D:\\a', 3), f('D:\\b', 2), f('D:\\c', 1)]
    const { favorites, recents } = partitionSidebarFolders(recent, ['D:\\b'], new Set())
    expect(favorites.map((x) => x.path)).toEqual(['D:\\b'])
    expect(recents.map((x) => x.path)).toEqual(['D:\\a', 'D:\\c'])
  })

  // The regression this module exists for. The recents table is capped at 20
  // entries; favorites are an unbounded pin list. Building the favorites
  // section out of the recents table meant a favorite that aged out of the
  // window disappeared from the sidebar entirely.
  it('keeps a favorite that has aged out of the recents table', () => {
    const { favorites } = partitionSidebarFolders([f('D:\\recent', 1)], ['D:\\pinned-but-old'], new Set())
    expect(favorites).toEqual([{ path: 'D:\\pinned-but-old', name: 'pinned-but-old', lastOpened: 0 }])
  })

  it('shows favorites even when the recents table is empty', () => {
    const { favorites, recents } = partitionSidebarFolders([], ['D:\\x', 'D:\\y'], new Set())
    expect(favorites.map((x) => x.path)).toEqual(['D:\\x', 'D:\\y'])
    expect(recents).toEqual([])
  })

  it('prefers the recents row (real lastOpened) over a synthesized one', () => {
    const { favorites } = partitionSidebarFolders([f('D:\\a', 42)], ['D:\\a'], new Set())
    expect(favorites[0].lastOpened).toBe(42)
  })

  it('excludes open projects from both sections — they live in ACTIVE', () => {
    const recent = [f('D:\\open', 3), f('D:\\closed', 2)]
    const active = new Set(['D:\\open', 'D:\\fav-open'])
    const { favorites, recents } = partitionSidebarFolders(recent, ['D:\\fav-open'], active)
    expect(favorites).toEqual([])
    expect(recents.map((x) => x.path)).toEqual(['D:\\closed'])
  })

  it('sorts favorites by name and recents newest-first', () => {
    const recent = [f('D:\\old', 1), f('D:\\new', 9)]
    const { favorites, recents } = partitionSidebarFolders(recent, ['D:\\zeta', 'D:\\alpha'], new Set())
    expect(favorites.map((x) => x.name)).toEqual(['alpha', 'zeta'])
    expect(recents.map((x) => x.name)).toEqual(['new', 'old'])
  })

  it('dedupes a repeated favorite path', () => {
    const { favorites } = partitionSidebarFolders([], ['D:\\a', 'D:\\a'], new Set())
    expect(favorites).toHaveLength(1)
  })

  it('draws at most RECENT_DISPLAY_LIMIT recents, newest first', () => {
    // The table holds up to RECENT_LIMIT (50); the sidebar shows a slice.
    const recent = Array.from({ length: 40 }, (_, i) => f(`D:\\p${String(i).padStart(2, '0')}`, i))
    const { recents } = partitionSidebarFolders(recent, [], new Set())
    expect(recents).toHaveLength(RECENT_DISPLAY_LIMIT)
    expect(recents[0].name).toBe('p39')
    expect(recents.at(-1)!.name).toBe(`p${39 - (RECENT_DISPLAY_LIMIT - 1)}`)
  })

  it('never truncates favorites — every pin is explicit', () => {
    const favs = Array.from({ length: RECENT_DISPLAY_LIMIT + 20 }, (_, i) => `D:\\fav${i}`)
    const { favorites } = partitionSidebarFolders([], favs, new Set())
    expect(favorites).toHaveLength(favs.length)
  })

  it('handles posix paths and a trailing separator', () => {
    expect(folderNameFromPath('/home/leon/proj')).toBe('proj')
    expect(folderNameFromPath('D:\\')).toBe('D:\\')
  })
})
