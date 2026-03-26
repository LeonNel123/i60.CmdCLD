import { describe, it, expect } from 'vitest'
import { calculateLayout } from '../src/renderer/src/utils/grid-layout'

describe('calculateLayout', () => {
  it('returns empty array for 0 terminals', () => {
    expect(calculateLayout(0)).toEqual([])
  })

  it('returns full-width for 1 terminal', () => {
    expect(calculateLayout(1)).toEqual([
      { i: '0', x: 0, y: 0, w: 12, h: 1 }
    ])
  })

  it('returns side-by-side for 2 terminals', () => {
    const layout = calculateLayout(2)
    expect(layout).toEqual([
      { i: '0', x: 0, y: 0, w: 6, h: 1 },
      { i: '1', x: 6, y: 0, w: 6, h: 1 }
    ])
  })

  it('returns 2x2 grid for 4 terminals', () => {
    const layout = calculateLayout(4)
    expect(layout).toEqual([
      { i: '0', x: 0, y: 0, w: 6, h: 1 },
      { i: '1', x: 6, y: 0, w: 6, h: 1 },
      { i: '2', x: 0, y: 1, w: 6, h: 1 },
      { i: '3', x: 6, y: 1, w: 6, h: 1 }
    ])
  })

  it('returns 3-column grid for 6 terminals', () => {
    const layout = calculateLayout(6)
    expect(layout[0]).toEqual({ i: '0', x: 0, y: 0, w: 4, h: 1 })
    expect(layout[3]).toEqual({ i: '3', x: 0, y: 1, w: 4, h: 1 })
    expect(layout.length).toBe(6)
  })

  it('returns 3-column grid for 8 terminals', () => {
    const layout = calculateLayout(8)
    expect(layout[0].w).toBe(4)
    expect(layout.length).toBe(8)
  })

  it('all items have positive width and height', () => {
    for (let n = 1; n <= 8; n++) {
      const layout = calculateLayout(n)
      for (const item of layout) {
        expect(item.w).toBeGreaterThan(0)
        expect(item.h).toBeGreaterThan(0)
      }
    }
  })
})
