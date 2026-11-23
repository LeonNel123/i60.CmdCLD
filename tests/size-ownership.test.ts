import { describe, it, expect } from 'vitest'
import { takesSizeOnLoad, markAutoReload, consumeAutoReload } from '../src/shared/size-ownership'

function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
    removeItem: (k: string) => { data.delete(k) },
  }
}

// Opening the page is using it, so it takes PTY size as it loads. A page that
// reloaded by itself — the app restarted and the socket came back — was not
// opened by anyone, and neither was one loading in a background tab.
describe('takesSizeOnLoad — a page someone opened takes the size', () => {
  it('takes it when the page is in front and nobody reloaded it automatically', () => {
    expect(takesSizeOnLoad({ visible: true, focused: true, autoReloaded: false })).toBe(true)
  })

  it('leaves it alone in a background tab', () => {
    expect(takesSizeOnLoad({ visible: false, focused: false, autoReloaded: false })).toBe(false)
  })

  it('leaves it alone in a window that is showing but not the one being used', () => {
    expect(takesSizeOnLoad({ visible: true, focused: false, autoReloaded: false })).toBe(false)
  })

  it('leaves it alone after reloading by itself, even in front', () => {
    expect(takesSizeOnLoad({ visible: true, focused: true, autoReloaded: true })).toBe(false)
  })
})

describe('auto-reload marker', () => {
  it('is seen once by the page that loads next', () => {
    const s = storage()
    markAutoReload(s)
    expect(consumeAutoReload(s)).toBe(true)
    expect(consumeAutoReload(s)).toBe(false)
  })

  it('is absent on an ordinary load', () => {
    expect(consumeAutoReload(storage())).toBe(false)
  })

  it('copes with storage that is missing or refuses', () => {
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(() => markAutoReload(undefined)).not.toThrow()
    expect(() => markAutoReload(broken)).not.toThrow()
    expect(consumeAutoReload(undefined)).toBe(false)
    expect(consumeAutoReload(broken)).toBe(false)
  })
})
