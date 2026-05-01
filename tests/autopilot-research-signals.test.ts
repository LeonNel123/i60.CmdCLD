import { describe, it, expect } from 'vitest'
import { detectResearchSignals } from '../src/main/autopilot-pro/research-signals'

describe('detectResearchSignals', () => {
  it('detects URLs', () => {
    const r = detectResearchSignals('build a thing using https://example.com/api and https://docs.example.com')
    expect(r).not.toBeNull()
    expect(r!.urls).toContain('https://example.com/api')
    expect(r!.urls).toContain('https://docs.example.com')
  })

  it('detects GitHub repo patterns', () => {
    const r = detectResearchSignals('look at owner/repo.git and another/proj for examples')
    expect(r).not.toBeNull()
    expect(r!.repos).toContain('owner/repo')
  })

  it('detects research keywords', () => {
    const r = detectResearchSignals('please investigate the current state of backup encryption')
    expect(r).not.toBeNull()
    expect(r!.keywords).toContain('investigate')
  })

  it('detects comparison signals', () => {
    const r = detectResearchSignals('compare X vs Y for our use case')
    expect(r).not.toBeNull()
    expect(r!.keywords).toContain('compare')
    expect(r!.comparisons.length).toBeGreaterThan(0)
  })

  it('merges multiple signal types', () => {
    const r = detectResearchSignals('research https://example.com and compare libfoo vs libbar')
    expect(r).not.toBeNull()
    expect(r!.urls.length).toBe(1)
    expect(r!.keywords).toContain('research')
    expect(r!.keywords).toContain('compare')
    expect(r!.comparisons.length).toBeGreaterThan(0)
  })

  it('returns null for plain ideas', () => {
    expect(detectResearchSignals('build a todo app')).toBeNull()
    expect(detectResearchSignals('add login to my project')).toBeNull()
  })
})
