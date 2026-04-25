import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../src/renderer/src/utils/format-relative-time'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000

  it('returns empty string for falsy timestamps', () => {
    expect(formatRelativeTime(0, now)).toBe('')
    expect(formatRelativeTime(NaN, now)).toBe('')
  })

  it('returns "just now" for timestamps in the future or under a minute', () => {
    expect(formatRelativeTime(now + 5000, now)).toBe('just now')
    expect(formatRelativeTime(now, now)).toBe('just now')
    expect(formatRelativeTime(now - 30 * SECOND, now)).toBe('just now')
    expect(formatRelativeTime(now - 59 * SECOND, now)).toBe('just now')
  })

  it('returns minutes for under an hour', () => {
    expect(formatRelativeTime(now - 1 * MINUTE, now)).toBe('1m')
    expect(formatRelativeTime(now - 5 * MINUTE, now)).toBe('5m')
    expect(formatRelativeTime(now - 59 * MINUTE, now)).toBe('59m')
  })

  it('returns hours for under a day', () => {
    expect(formatRelativeTime(now - 1 * HOUR, now)).toBe('1h')
    expect(formatRelativeTime(now - 23 * HOUR, now)).toBe('23h')
  })

  it('returns days for under a week', () => {
    expect(formatRelativeTime(now - 1 * DAY, now)).toBe('1d')
    expect(formatRelativeTime(now - 6 * DAY, now)).toBe('6d')
  })

  it('returns weeks for under 4 weeks', () => {
    expect(formatRelativeTime(now - 1 * WEEK, now)).toBe('1w')
    expect(formatRelativeTime(now - 3 * WEEK, now)).toBe('3w')
  })

  it('returns weeks for the 28-29 day boundary (no zero-month bucket)', () => {
    expect(formatRelativeTime(now - 28 * DAY, now)).toBe('4w')
    expect(formatRelativeTime(now - 29 * DAY, now)).toBe('4w')
    expect(formatRelativeTime(now - 30 * DAY, now)).toBe('1mo')
  })

  it('returns months for under a year', () => {
    expect(formatRelativeTime(now - 1 * MONTH, now)).toBe('1mo')
    expect(formatRelativeTime(now - 6 * MONTH, now)).toBe('6mo')
    expect(formatRelativeTime(now - 11 * MONTH, now)).toBe('11mo')
  })

  it('returns years for one year or more', () => {
    expect(formatRelativeTime(now - 1 * YEAR, now)).toBe('1y')
    expect(formatRelativeTime(now - 5 * YEAR, now)).toBe('5y')
  })

  it('uses real Date.now when second argument is omitted', () => {
    const recent = Date.now() - 5 * MINUTE
    expect(formatRelativeTime(recent)).toBe('5m')
  })
})
