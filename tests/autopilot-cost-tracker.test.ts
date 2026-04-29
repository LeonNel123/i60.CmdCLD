import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CostTracker } from '../src/main/autopilot/cost-tracker'

const TMP = join(__dirname, '.tmp-autopilot-cost-tracker')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('CostTracker', () => {
  it('starts at $0 with no prior file', () => {
    const t = new CostTracker(TMP, 1.0)
    expect(t.totalUsd).toBe(0)
  })

  it('accumulates usage and persists', () => {
    const t = new CostTracker(TMP, 1.0)
    t.add(0.05)
    t.add(0.10)
    expect(t.totalUsd).toBeCloseTo(0.15, 5)
    expect(existsSync(join(TMP, '.autopilot/cost.json'))).toBe(true)
    const t2 = new CostTracker(TMP, 1.0)
    expect(t2.totalUsd).toBeCloseTo(0.15, 5)
  })

  it('fires threshold callbacks at 50/80/100 percent', () => {
    const calls: number[] = []
    const t = new CostTracker(TMP, 1.0, (pct) => calls.push(pct))
    t.add(0.40); expect(calls).toEqual([])
    t.add(0.20); expect(calls).toEqual([50])
    t.add(0.30); expect(calls).toEqual([50, 80])
    t.add(0.20); expect(calls).toEqual([50, 80, 100])
  })

  it('only fires each threshold once', () => {
    const calls: number[] = []
    const t = new CostTracker(TMP, 1.0, (pct) => calls.push(pct))
    t.add(1.50)
    expect(calls).toEqual([50, 80, 100])
    t.add(0.10)
    expect(calls).toEqual([50, 80, 100])
  })

  it('isOverCap', () => {
    const t = new CostTracker(TMP, 1.0)
    t.add(0.5); expect(t.isOverCap()).toBe(false)
    t.add(0.6); expect(t.isOverCap()).toBe(true)
  })

  it('extendCap raises ceiling and resets crossed thresholds', () => {
    const calls: number[] = []
    const t = new CostTracker(TMP, 1.0, (pct) => calls.push(pct))
    t.add(1.10)
    expect(t.isOverCap()).toBe(true)
    t.extendCap(2.0)
    expect(t.isOverCap()).toBe(false)
    t.add(0.40)
    expect(calls).toEqual([50, 80, 100])
  })
})
