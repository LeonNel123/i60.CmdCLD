import { describe, it, expect } from 'vitest'
import { assignColor, COLOR_POOL } from '../src/renderer/src/utils/colors'

describe('COLOR_POOL', () => {
  it('has at least 12 colors', () => {
    expect(COLOR_POOL.length).toBeGreaterThanOrEqual(12)
  })

  it('contains only valid hex colors', () => {
    for (const c of COLOR_POOL) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('assignColor', () => {
  it('returns a color from the pool when none are used', () => {
    const color = assignColor([])
    expect(COLOR_POOL).toContain(color)
  })

  it('does not return a color that is already used', () => {
    const used = COLOR_POOL.slice(0, 5)
    for (let i = 0; i < 20; i++) {
      const color = assignColor(used)
      expect(used).not.toContain(color)
    }
  })

  it('returns a pool color even when all are used (wraps around)', () => {
    const color = assignColor([...COLOR_POOL])
    expect(COLOR_POOL).toContain(color)
  })
})
