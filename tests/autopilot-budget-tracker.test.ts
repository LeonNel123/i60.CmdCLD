import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadBudget, recordSpend, getSnapshot, setProjectCap, setGlobalCap, resetTodaySpend, _setBudgetPathForTest } from '../src/main/autopilot/budget-tracker'

const TMP = join(__dirname, '.tmp-budget')
const BUDGET_FILE = join(TMP, 'cost-budget.json')

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  _setBudgetPathForTest(BUDGET_FILE)
})
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('budget-tracker', () => {
  it('default state on first load (no file exists)', () => {
    const state = loadBudget()
    expect(state.global.spentUsd).toBe(0)
    expect(state.global.capUsd).toBe(20)
    expect(Object.keys(state.perProject)).toEqual([])
  })

  it('recordSpend updates per-project + global', () => {
    recordSpend('/proj/a', 0.5)
    const snap = getSnapshot('/proj/a')
    expect(snap.projectSpent).toBe(0.5)
    expect(snap.globalSpent).toBe(0.5)
    expect(snap.projectCap).toBe(5)
    expect(snap.globalCap).toBe(20)
    expect(snap.capReached).toBe(false)
  })

  it('cap-reached true when project cap hit', () => {
    setProjectCap('/proj/a', 1)
    recordSpend('/proj/a', 1.5)
    const snap = getSnapshot('/proj/a')
    expect(snap.capReached).toBe(true)
    expect(snap.capReachedReason).toBe('project')
  })

  it('cap-reached true when global cap hit', () => {
    setGlobalCap(1)
    recordSpend('/proj/a', 0.5)
    recordSpend('/proj/b', 0.6)
    const snap = getSnapshot('/proj/a')
    expect(snap.capReached).toBe(true)
    expect(snap.capReachedReason).toBe('global')
  })

  it('warning threshold fires at 80% of project cap', () => {
    setProjectCap('/proj/a', 1)
    recordSpend('/proj/a', 0.85)
    const snap = getSnapshot('/proj/a')
    expect(snap.warningThreshold).toBe(true)
    expect(snap.capReached).toBe(false)
  })

  it('warning threshold fires at 80% of global cap', () => {
    setProjectCap('/proj/a', 100)  // isolate from project-cap; this test exercises global cap only
    setGlobalCap(10)
    recordSpend('/proj/a', 8.5)
    const snap = getSnapshot('/proj/a')
    expect(snap.warningThreshold).toBe(true)
    expect(snap.capReached).toBe(false)
  })

  it('date rollover resets perProject map at midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T23:59:00'))
    recordSpend('/proj/a', 4.5)
    expect(getSnapshot('/proj/a').projectSpent).toBe(4.5)
    vi.setSystemTime(new Date('2026-05-02T00:01:00'))
    const snap = getSnapshot('/proj/a')
    expect(snap.projectSpent).toBe(0)   // rolled over
    expect(snap.globalSpent).toBe(0)
  })

  it('setProjectCap updates without resetting spend', () => {
    recordSpend('/proj/a', 2)
    setProjectCap('/proj/a', 10)
    const snap = getSnapshot('/proj/a')
    expect(snap.projectSpent).toBe(2)
    expect(snap.projectCap).toBe(10)
  })

  it('setGlobalCap updates without resetting spend', () => {
    recordSpend('/proj/a', 2)
    setGlobalCap(50)
    const snap = getSnapshot('/proj/a')
    expect(snap.globalSpent).toBe(2)
    expect(snap.globalCap).toBe(50)
  })

  it('resetTodaySpend zeroes both project and global', () => {
    recordSpend('/proj/a', 2)
    recordSpend('/proj/b', 1)
    resetTodaySpend()
    expect(getSnapshot('/proj/a').projectSpent).toBe(0)
    expect(getSnapshot('/proj/a').globalSpent).toBe(0)
  })

  it('recordSpend rejects NaN/negative without state corruption', () => {
    recordSpend('/proj/a', 1.0)
    recordSpend('/proj/a', NaN)
    recordSpend('/proj/a', -5)
    recordSpend('/proj/a', Infinity)
    const snap = getSnapshot('/proj/a')
    expect(snap.projectSpent).toBe(1.0)
    expect(snap.globalSpent).toBe(1.0)
  })
})
