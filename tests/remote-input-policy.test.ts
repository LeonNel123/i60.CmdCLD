import { describe, it, expect } from 'vitest'
import { resolveInputPlatform, pastePolicy, browserClipboardKey, pastedImageFile, inputPlatformOf, modKeyPressed, modKeyLabel, appShortcutOf, terminalYieldsKey, setShortcutsDisabled, shortcutsDisabled } from '../src/renderer/src/remote/input-policy'

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

// The app's own shortcuts (palette, tile switching) and Mod+click on a link
// asked the *host* which key is Mod. On the browser page the keyboard is the
// browser's: a Mac host made a Windows browser need the Windows key, which
// the OS takes for itself, and a Windows host made a Mac need Ctrl+click,
// which macOS turns into a right-click.
describe('whose modifier key', () => {
  const win = (remote: boolean, host: string, nav: string) => ({ api: { remote, platform: host }, navigator: { platform: nav } })

  it('follows the host in the Electron window', () => {
    expect(inputPlatformOf(win(false, 'darwin', 'Win32'))).toBe('darwin')
    expect(inputPlatformOf(win(false, 'win32', 'MacIntel'))).toBe('other')
  })

  it('follows the browser on the /desktop page', () => {
    expect(inputPlatformOf(win(true, 'darwin', 'Win32'))).toBe('other')
    expect(inputPlatformOf(win(true, 'win32', 'MacIntel'))).toBe('darwin')
    expect(inputPlatformOf(win(true, 'win32', 'iPad'))).toBe('darwin')
  })

  it('reads Cmd as Mod on a Mac keyboard and Ctrl everywhere else', () => {
    expect(modKeyPressed({ metaKey: true, ctrlKey: false }, 'darwin')).toBe(true)
    expect(modKeyPressed({ metaKey: false, ctrlKey: true }, 'darwin')).toBe(false)
    expect(modKeyPressed({ metaKey: false, ctrlKey: true }, 'other')).toBe(true)
    expect(modKeyPressed({ metaKey: true, ctrlKey: false }, 'other')).toBe(false)
  })

  it('names the key the way that keyboard prints it', () => {
    expect(modKeyLabel('darwin')).toBe('⌘')
    expect(modKeyLabel('other')).toBe('Ctrl')
  })
})

// The app's shortcuts are handled on window, after xterm. Where xterm turns a
// key into input it also stops the event, so with a terminal focused on
// Windows the app never saw Ctrl+3..8 (typed into the agent as control
// characters, Ctrl+3 being Escape) or Ctrl+P/T/B.
describe('app shortcuts', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

  it('recognises each shortcut on both keyboards', () => {
    expect(appShortcutOf(key('3', { ctrlKey: true }), 'other')).toEqual({ kind: 'terminal', index: 2 })
    expect(appShortcutOf(key('9', { metaKey: true }), 'darwin')).toEqual({ kind: 'terminal', index: 8 })
    expect(appShortcutOf(key('`', { ctrlKey: true }), 'other')).toEqual({ kind: 'grid' })
    expect(appShortcutOf(key('t', { ctrlKey: true }), 'other')).toEqual({ kind: 'add-folder' })
    expect(appShortcutOf(key('b', { metaKey: true }), 'darwin')).toEqual({ kind: 'broadcast' })
    expect(appShortcutOf(key('P', { ctrlKey: true, shiftKey: true }), 'other')).toEqual({ kind: 'palette' })
  })

  it('ignores the key without the modifier, with Alt, or with the modifier of the other OS', () => {
    expect(appShortcutOf(key('t'), 'other')).toBeNull()
    expect(appShortcutOf(key('t', { ctrlKey: true, altKey: true }), 'other')).toBeNull()
    expect(appShortcutOf(key('t', { metaKey: true }), 'other')).toBeNull()
    expect(appShortcutOf(key('t', { ctrlKey: true }), 'darwin')).toBeNull()
    expect(appShortcutOf(key('0', { ctrlKey: true }), 'other')).toBeNull()
    expect(appShortcutOf(key('x', { ctrlKey: true }), 'other')).toBeNull()
  })

  it('keeps Cmd+Shift+letter free on a Mac, as before', () => {
    expect(appShortcutOf(key('P', { metaKey: true, shiftKey: true }), 'darwin')).toBeNull()
  })

  // Ctrl+digit and Ctrl+` mean nothing useful to a terminal: always the app's.
  it('takes the digit and grid shortcuts from the terminal', () => {
    for (const k of ['1', '3', '5', '8', '9', '`']) {
      expect(terminalYieldsKey(key(k, { ctrlKey: true }), 'other'), k).toBe(true)
    }
    expect(terminalYieldsKey(key('3', { metaKey: true }), 'darwin')).toBe(true)
  })

  // Ctrl+P, Ctrl+T and Ctrl+B are real terminal keys (history, Claude Code's
  // task list and background, tmux's prefix). They stay the terminal's; with
  // Shift added they are the app's.
  it('leaves plain Ctrl+letter to the terminal and takes Ctrl+Shift+letter', () => {
    for (const k of ['p', 't', 'b']) {
      expect(terminalYieldsKey(key(k, { ctrlKey: true }), 'other'), k).toBe(false)
      expect(terminalYieldsKey(key(k.toUpperCase(), { ctrlKey: true, shiftKey: true }), 'other'), k).toBe(true)
    }
  })

  it('takes Cmd+letter on a Mac, where Cmd is never terminal input', () => {
    expect(terminalYieldsKey(key('t', { metaKey: true }), 'darwin')).toBe(true)
  })

  it('leaves every other key to the terminal', () => {
    expect(terminalYieldsKey(key('c', { ctrlKey: true }), 'other')).toBe(false)
    expect(terminalYieldsKey(key('r', { ctrlKey: true }), 'other')).toBe(false)
    expect(terminalYieldsKey(key('3'), 'other')).toBe(false)
    expect(terminalYieldsKey(key('V', { ctrlKey: true, shiftKey: true }), 'other')).toBe(false)
  })
})

// "I type something in a console and suddenly something happens in the app."
// With the setting on, no key does anything but reach the program.
describe('shortcuts disabled by the setting', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

  it('recognises no app shortcut and takes no key from the terminal', () => {
    setShortcutsDisabled(true)
    try {
      for (const k of ['1', '3', '9', '`', 't', 'b', 'p']) {
        expect(appShortcutOf(key(k, { ctrlKey: true }), 'other'), k).toBeNull()
        expect(appShortcutOf(key(k, { metaKey: true }), 'darwin'), k).toBeNull()
        expect(terminalYieldsKey(key(k, { ctrlKey: true }), 'other'), k).toBe(false)
        expect(terminalYieldsKey(key(k.toUpperCase(), { ctrlKey: true, shiftKey: true }), 'other'), k).toBe(false)
      }
      expect(shortcutsDisabled()).toBe(true)
    } finally {
      setShortcutsDisabled(false)
    }
  })

  it('is off unless set', () => {
    expect(shortcutsDisabled()).toBe(false)
    expect(appShortcutOf(key('t', { ctrlKey: true }), 'other')).toEqual({ kind: 'add-folder' })
  })
})
