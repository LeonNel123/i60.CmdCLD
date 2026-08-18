import { describe, it, expect } from 'vitest'
import { slugify, parseRepoCodes, resolveCode, composeFileName, renderDocument } from '../src/main/relay/compose'

const REPOS_MD = [
  '# Repo codes',
  '',
  '| Code | Repo | Canonical location |',
  '| --- | --- | --- |',
  '| `ALPHA` | AlphaProject | somewhere |',
  '| `BRAVO` | Bravo (bravo-reimagined) | elsewhere |',
  '',
  '## Foreign codes',
  '| `CHARLIE` | Charlie.Sec | hub |',
].join('\n')

describe('compose helpers', () => {
  it('slugifies subjects into bounded kebab-case', () => {
    expect(slugify('Add a health endpoint, please!')).toBe('add-a-health-endpoint-please')
    expect(slugify('  ---  ')).toBe('request')
    expect(slugify('x'.repeat(200))).toHaveLength(48)
  })

  it('parses codes from REPOS.md tables, including parentheticals and foreign codes', () => {
    const codes = parseRepoCodes(REPOS_MD)
    expect(codes.get('alphaproject')).toBe('ALPHA')
    expect(codes.get('alpha')).toBe('ALPHA')
    expect(codes.get('bravo')).toBe('BRAVO')
    expect(codes.get('bravo-reimagined')).toBe('BRAVO')
    expect(codes.get('charlie.sec')).toBe('CHARLIE')
  })

  it('resolves session names to codes with fallback to an uppercased name', () => {
    const codes = parseRepoCodes(REPOS_MD)
    expect(resolveCode('bravo-reimagined', codes)).toBe('BRAVO')
    expect(resolveCode('AlphaProject', codes)).toBe('ALPHA')
    // substring both ways
    expect(resolveCode('Charlie', codes)).toBe('CHARLIE')
    // unknown degrades to a readable name, not an error
    expect(resolveCode('my.new-repo', codes)).toBe('MYNEWREPO')
  })

  it('builds protocol thread names', () => {
    const name = composeFileName('ALPHA', 'BRAVO', new Date(2026, 7, 18), 'Add a health endpoint')
    expect(name).toBe('ALPHA-to-BRAVO-REQ-20260818-add-a-health-endpoint.md')
  })

  it('renders the document with title, provenance line, and body', () => {
    const doc = renderDocument({
      fileTitle: 'ALPHA-to-BRAVO-REQ-20260818-x.md',
      fromName: 'AlphaProject', fromCode: 'ALPHA',
      date: new Date(Date.UTC(2026, 7, 18)), body: 'The ask.\n',
    })
    expect(doc).toContain('# ALPHA-to-BRAVO-REQ-20260818-x\n')
    expect(doc).toContain('*From: AlphaProject (`ALPHA`) — 2026-08-18.')
    expect(doc.endsWith('The ask.\n')).toBe(true)
  })
})
