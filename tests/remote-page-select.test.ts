import { describe, it, expect } from 'vitest'
// Browser IIFE with a CommonJS export, same pattern as input-sanitizer.js.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { choosePage, deviceWidth, STORAGE_KEY } = require('../src/remote-ui/page-select.js')

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
    expect(choosePage({ page: 'desktop', width: 1400, search: '?mobile', stored: null })).toEqual({ go: '/?mobile', remember: 'mobile' })
  })
  it('?desktop wins over width and is remembered', () => {
    expect(choosePage({ page: 'mobile', width: 400, search: '?desktop=1', stored: 'mobile' })).toEqual({ go: '/desktop/?desktop', remember: 'desktop' })
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

describe('deviceWidth — phone vs desktop', () => {
  const win = (o: { coarse: boolean; sw?: number; sh?: number; inner: number }) => ({
    matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' && o.coarse }),
    screen: { width: o.sw ?? 0, height: o.sh ?? 0 },
    innerWidth: o.inner,
  })
  it('a phone in landscape is still a phone (touch: short side of the screen)', () => {
    // iPhone 15 Pro Max landscape: 932 wide, short side 430.
    expect(deviceWidth(win({ coarse: true, sw: 932, sh: 430, inner: 932 }))).toBe(430)
  })
  it('a 1366x768 laptop stays on the desktop page (mouse: window width)', () => {
    expect(deviceWidth(win({ coarse: false, sw: 1366, sh: 768, inner: 1366 }))).toBe(1366)
  })
  it('a desktop window narrowed by hand still follows the window width, as before', () => {
    expect(deviceWidth(win({ coarse: false, sw: 1920, sh: 1080, inner: 600 }))).toBe(600)
  })
  it('falls back to innerWidth when matchMedia or the screen size is missing', () => {
    expect(deviceWidth({ innerWidth: 900 })).toBe(900)
    expect(deviceWidth(win({ coarse: true, inner: 500 }))).toBe(500)
  })
})
