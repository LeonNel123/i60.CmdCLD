import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { nextAdrNumber, adrSlug, buildAdrId, parseAdr } from '../src/main/autopilot-pro/adr'

const TMP = join(__dirname, '.tmp-adr')
const DECISIONS_DIR = join(TMP, 'docs', 'decisions')

beforeEach(() => { mkdirSync(DECISIONS_DIR, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('nextAdrNumber', () => {
  it('returns 0001 on empty directory', () => {
    expect(nextAdrNumber(TMP)).toBe('0001')
  })

  it('returns 0042 when 0041 exists', () => {
    writeFileSync(join(DECISIONS_DIR, '0041-something.md'), '# 0041\n')
    expect(nextAdrNumber(TMP)).toBe('0042')
  })
})

describe('adrSlug', () => {
  it('produces kebab-case', () => {
    expect(adrSlug('Foundational Choices')).toBe('foundational-choices')
  })

  it('caps at 50 characters', () => {
    expect(adrSlug('A very long title that goes on and on and on and on').length).toBeLessThanOrEqual(50)
  })
})

describe('parseAdr', () => {
  it('accepts well-formed ADR', () => {
    const text = `# ADR-0001: Test Decision

## Status
Accepted

## Context
We need to decide.

## Decision
We chose X.

## Consequences
Y will happen.
`
    const result = parseAdr(text)
    expect(result).not.toBeNull()
    expect(result!.title).toContain('Test Decision')
    expect(result!.status).toMatch(/Accepted/i)
  })

  it('rejects ADR missing Status section', () => {
    const text = `# ADR-0001: Test\n\n## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n`
    expect(parseAdr(text)).toBeNull()
  })

  it('rejects ADR missing Decision section', () => {
    const text = `# ADR-0001: Test\n\n## Status\nAccepted\n\n## Context\nx\n\n## Consequences\nx\n`
    expect(parseAdr(text)).toBeNull()
  })

  it('accepts ADR with optional Alternatives Considered', () => {
    const text = `# ADR-0001: Test\n\n## Status\nAccepted\n\n## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n\n## Alternatives Considered\n- A\n- B\n`
    expect(parseAdr(text)).not.toBeNull()
  })
})
