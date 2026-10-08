import { describe, it, expect } from 'vitest'
// Browser IIFE with a CommonJS export, same pattern as input-sanitizer.js.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { choosePage, STORAGE_KEY } = require('../src/remote-ui/page-select.js')

describe('choosePage', () => {
  it('sends a wide viewport on the phone page to /desktop/', () => {
    expect(choosePage({ page: 'mobile', width: 769, search: '', stored: null })).toEqual({ go: '/desktop/', remember: null })
  })
  it('keeps a narrow viewport on the phone page', () => {
    expect(choosePage({ page: 'mobile', width: 768, search: '', stored: null })).toEqual({ go: null, remember: null })
  })
  it('sends a narrow viewport on the desktop page back to /', () => {
    expect(choosePage({ page: 'desktop', width: 500, search: '', stored: null })).toEqual({ go: '/', remember: null })
  })
  it('?mobile wins over width and is remembered', () => {
    expect(choosePage({ page: 'mobile', width: 1400, search: '?mobile', stored: 'desktop' })).toEqual({ go: null, remember: 'mobile' })
    expect(choosePage({ page: 'desktop', width: 1400, search: '?mobile', stored: null })).toEqual({ go: '/', remember: 'mobile' })
  })
  it('?desktop wins over width and is remembered', () => {
    expect(choosePage({ page: 'mobile', width: 400, search: '?desktop=1', stored: 'mobile' })).toEqual({ go: '/desktop/', remember: 'desktop' })
    expect(choosePage({ page: 'desktop', width: 400, search: '?desktop', stored: null })).toEqual({ go: null, remember: 'desktop' })
  })
  it('a stored choice beats width', () => {
    expect(choosePage({ page: 'mobile', width: 1400, search: '', stored: 'mobile' })).toEqual({ go: null, remember: null })
    expect(choosePage({ page: 'mobile', width: 400, search: '', stored: 'desktop' })).toEqual({ go: '/desktop/', remember: null })
    expect(choosePage({ page: 'desktop', width: 1400, search: '', stored: 'mobile' })).toEqual({ go: '/', remember: null })
  })
  it('exports the storage key', () => {
    expect(STORAGE_KEY).toBe('cmdcld-remote-page')
  })
})
