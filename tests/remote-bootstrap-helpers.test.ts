import { describe, it, expect } from 'vitest'
import { installRandomUuidPolyfill } from '../src/renderer/src/remote/uuid-polyfill'
import { copyText } from '../src/renderer/src/remote/copy-text'

describe('installRandomUuidPolyfill', () => {
  it('adds a v4-shaped randomUUID when the context lacks one (plain http on a LAN IP)', () => {
    const c: any = { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = i * 37 % 256; return a } }
    installRandomUuidPolyfill(c)
    const id = c.randomUUID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('leaves an existing randomUUID alone', () => {
    const orig = () => 'native'
    const c: any = { randomUUID: orig, getRandomValues: (a: Uint8Array) => a }
    installRandomUuidPolyfill(c)
    expect(c.randomUUID).toBe(orig)
  })
})

describe('copyText', () => {
  it('returns false and does not throw when neither clipboard API nor document exists', () => {
    expect(copyText('x')).toBe(false)
  })
  it('returns false for empty text', () => {
    expect(copyText('')).toBe(false)
  })
})
