import { describe, it, expect } from 'vitest'
import { RemoteServer } from '../src/main/remote-server'

// /desktop lists every session, so every desktop window has to hear who owns
// PTY size — not just the first. A second window that missed the announcement
// kept fitting (fighting the browser) or, opened mid-session, stayed passive.
describe('size-owner announcement', () => {
  const wc = (sent: unknown[], destroyed = false) =>
    ({ isDestroyed: () => destroyed, send: (_ch: string, msg: unknown) => { sent.push(msg) } }) as any

  function server(windows: any[]) {
    return new RemoteServer({
      ptyManager: {} as any,
      settings: {} as any,
      recentDB: {} as any,
      getWebContents: () => windows[0] ?? null,
      getAllWebContents: () => windows,
    })
  }

  it('reaches every live window', () => {
    const a: unknown[] = [], b: unknown[] = [], gone: unknown[] = []
    const s = server([wc(a), wc(b), wc(gone, true)])
    ;(s as any).announceSizeOwner('remote')
    ;(s as any).announceSizeOwner('local')
    expect(a).toEqual([{ remote: true }, { remote: false }])
    expect(b).toEqual([{ remote: true }, { remote: false }])
    expect(gone).toEqual([])
  })

  it('falls back to the single window when no list is given', () => {
    const a: unknown[] = []
    const s = new RemoteServer({ ptyManager: {} as any, settings: {} as any, recentDB: {} as any, getWebContents: () => wc(a) })
    ;(s as any).announceSizeOwner('remote')
    expect(a).toEqual([{ remote: true }])
  })
})

import { imageExtension } from '../src/main/remote-server'

describe('imageExtension — uploads are named for what they are', () => {
  it('maps common phone and screenshot types', () => {
    expect(imageExtension('image/jpeg')).toBe('jpg')
    expect(imageExtension('image/png')).toBe('png')
    expect(imageExtension('IMAGE/WEBP; charset=binary')).toBe('webp')
    expect(imageExtension('image/heic')).toBe('heic')
  })
  it('falls back to png, as before', () => {
    expect(imageExtension(undefined)).toBe('png')
    expect(imageExtension('application/octet-stream')).toBe('png')
  })
})
