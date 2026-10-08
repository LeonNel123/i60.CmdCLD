import { describe, it, expect } from 'vitest'
import { resolveInputPlatform, pastePolicy } from '../src/renderer/src/remote/input-policy'

describe('resolveInputPlatform — which OS the keyboard belongs to', () => {
  it('in Electron the host platform is the keyboard platform', () => {
    expect(resolveInputPlatform({ remote: false, hostPlatform: 'darwin', navigatorPlatform: 'Win32' })).toBe('darwin')
    expect(resolveInputPlatform({ remote: false, hostPlatform: 'win32', navigatorPlatform: 'MacIntel' })).toBe('other')
  })
  it('on the browser page the client machine decides, not the host', () => {
    expect(resolveInputPlatform({ remote: true, hostPlatform: 'darwin', navigatorPlatform: 'Win32' })).toBe('other')
    expect(resolveInputPlatform({ remote: true, hostPlatform: 'win32', navigatorPlatform: 'MacIntel' })).toBe('darwin')
    expect(resolveInputPlatform({ remote: true, hostPlatform: 'linux', navigatorPlatform: 'iPad' })).toBe('darwin')
  })
})

describe('pastePolicy', () => {
  it('Electron intercepts the DOM paste and Mod+V so main can read images/files', () => {
    expect(pastePolicy(false)).toEqual({ interceptNativePaste: true, interceptModV: true })
  })
  it('the browser page leaves paste to xterm — the DOM paste event works in insecure contexts', () => {
    expect(pastePolicy(true)).toEqual({ interceptNativePaste: false, interceptModV: false })
  })
})
