import { describe, it, expect } from 'vitest'
import { resolveInputPlatform, pastePolicy, browserClipboardKey, pastedImageFile } from '../src/renderer/src/remote/input-policy'

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

describe('browserClipboardKey — shortcuts handed to the browser\'s native clipboard', () => {
  const key = (k: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}, type = 'keydown') =>
    ({ type, key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m })

  it('Ctrl+V on Windows/Linux is paste, not ^V to the PTY', () => {
    expect(browserClipboardKey(key('v', { ctrlKey: true }), 'other', false)).toBe('paste')
    expect(browserClipboardKey(key('V', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('paste')
  })
  it('Cmd+V on a Mac is paste; Ctrl+V on a Mac stays a keystroke', () => {
    expect(browserClipboardKey(key('v', { metaKey: true }), 'darwin', false)).toBe('paste')
    expect(browserClipboardKey(key('v', { ctrlKey: true }), 'darwin', false)).toBeNull()
  })
  it('copy needs a selection — Ctrl+C without one is the interrupt', () => {
    expect(browserClipboardKey(key('c', { ctrlKey: true }), 'other', true)).toBe('copy')
    expect(browserClipboardKey(key('c', { ctrlKey: true }), 'other', false)).toBeNull()
    expect(browserClipboardKey(key('c', { metaKey: true }), 'darwin', true)).toBe('copy')
  })
  it('leaves Ctrl+Shift+C, AltGr combos and keyup alone', () => {
    expect(browserClipboardKey(key('C', { ctrlKey: true, shiftKey: true }), 'other', true)).toBeNull()
    expect(browserClipboardKey(key('v', { ctrlKey: true, altKey: true }), 'other', false)).toBeNull()
    expect(browserClipboardKey(key('v', { ctrlKey: true }, 'keyup'), 'other', false)).toBeNull()
  })
})

describe('pastedImageFile', () => {
  const item = (kind: string, type: string, file: string | null = null) => ({ kind, type, getAsFile: () => file })
  it('uploads an image-only paste', () => {
    expect(pastedImageFile([item('file', 'image/png', 'IMG')])).toBe('IMG')
  })
  it('text wins when the clipboard carries both', () => {
    expect(pastedImageFile([item('file', 'image/png', 'IMG'), item('string', 'text/plain')])).toBeNull()
    expect(pastedImageFile([item('string', 'text/html'), item('file', 'image/png', 'IMG')])).toBeNull()
  })
  it('ignores non-image files', () => {
    expect(pastedImageFile([item('file', 'application/pdf', 'PDF')])).toBeNull()
  })
})
