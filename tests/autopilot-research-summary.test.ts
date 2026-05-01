import { describe, it, expect } from 'vitest'
import { parseResearchSummary } from '../src/main/autopilot-pro/research-summary'

const WELL_FORMED = `---
slug: backup-encryption
created: 2026-05-01
last-verified: 2026-05-01
sources:
  - https://example.com/foo
  - https://docs.example.com/bar
---

# Research: Backup encryption

## Question
What schemes apply?

## Findings
A and B are the two main options (1)(2).

## Implications for this project
- Use B with a 256-bit key.
`

describe('parseResearchSummary', () => {
  it('accepts well-formed summary', () => {
    const r = parseResearchSummary(WELL_FORMED)
    expect(r).not.toBeNull()
    expect(r!.slug).toBe('backup-encryption')
    expect(r!.sources.length).toBe(2)
    expect(r!.sections['question']).toContain('What schemes')
    expect(r!.sections['findings']).toContain('A and B')
    expect(r!.sections['implications for this project']).toContain('256-bit')
  })

  it('rejects when frontmatter missing slug', () => {
    const text = WELL_FORMED.replace(/^slug:.*\n/m, '')
    expect(parseResearchSummary(text)).toBeNull()
  })

  it('rejects when frontmatter has no sources', () => {
    const text = WELL_FORMED.replace(/^sources:[\s\S]+?(?=\n---)/m, 'sources: []')
    expect(parseResearchSummary(text)).toBeNull()
  })

  it('rejects when Question section missing', () => {
    const text = WELL_FORMED.replace(/## Question[\s\S]+?(?=## Findings)/, '')
    expect(parseResearchSummary(text)).toBeNull()
  })

  it('rejects when Implications section missing', () => {
    const text = WELL_FORMED.replace(/## Implications for this project[\s\S]+$/, '')
    expect(parseResearchSummary(text)).toBeNull()
  })
})
