/** Keyboard and paste rules that differ between the Electron window and the
 *  browser (/desktop) page. Pure, so the decisions are unit-tested while the
 *  TerminalPanel wiring stays a few lines. */

export type InputPlatform = 'darwin' | 'other'

/** Whose keyboard is this? In Electron the host's. On the browser page the
 *  person is at another machine, so Cmd-vs-Ctrl follows *that* machine —
 *  window.api.platform stays the host value for path-shaped decisions. */
export function resolveInputPlatform(args: {
  remote: boolean
  hostPlatform: string
  navigatorPlatform: string
}): InputPlatform {
  if (!args.remote) return args.hostPlatform === 'darwin' ? 'darwin' : 'other'
  return /mac|iphone|ipad|ipod/i.test(args.navigatorPlatform) ? 'darwin' : 'other'
}

/** The same question, asked of the page itself. Everything that reads a
 *  modifier key goes through this — the terminal's shortcuts, the app's own,
 *  and Mod+click on a link — so they cannot disagree about which key is Mod. */
export function inputPlatformOf(win: {
  api: { remote?: boolean; platform: string }
  navigator?: { platform?: string }
}): InputPlatform {
  return resolveInputPlatform({
    remote: Boolean(win.api.remote),
    hostPlatform: win.api.platform,
    navigatorPlatform: win.navigator?.platform ?? '',
  })
}

/** Is the primary shortcut modifier held: Cmd on a Mac keyboard, Ctrl elsewhere. */
export function modKeyPressed(e: { metaKey: boolean; ctrlKey: boolean }, platform: InputPlatform): boolean {
  return platform === 'darwin' ? e.metaKey : e.ctrlKey
}

/** How that modifier is printed in shortcut hints. */
export function modKeyLabel(platform: InputPlatform): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl'
}

// The "Disable keyboard shortcuts" setting. App.tsx keeps it in step with the
// setting; everything that would act on a key instead of passing it to the
// program asks here first. Copy and paste are not shortcuts in this sense.
let shortcutsOff = false
export function setShortcutsDisabled(disabled: boolean): void { shortcutsOff = disabled }
export function shortcutsDisabled(): boolean { return shortcutsOff }

export type AppShortcut =
  | { kind: 'terminal'; index: number }
  | { kind: 'grid' }
  | { kind: 'add-folder' }
  | { kind: 'broadcast' }
  | { kind: 'palette' }

type ShortcutKey = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

const LETTER_SHORTCUTS: Record<string, AppShortcut> = {
  t: { kind: 'add-folder' },
  b: { kind: 'broadcast' },
  p: { kind: 'palette' },
}

/** The app-level shortcut a key event stands for, if any. Mod+1..9 switches
 *  terminal, Mod+` shows the grid, Mod+T / B / P add a folder, toggle the
 *  broadcast bar and open the palette. Off a Mac the letters also work with
 *  Shift, which is the form that works while a terminal has focus. */
export function appShortcutOf(e: ShortcutKey, platform: InputPlatform): AppShortcut | null {
  if (shortcutsOff) return null
  if (e.altKey || !modKeyPressed(e, platform)) return null
  if (platform === 'darwin' ? e.ctrlKey : e.metaKey) return null
  if (!e.shiftKey && e.key >= '1' && e.key <= '9' && e.key.length === 1) {
    return { kind: 'terminal', index: parseInt(e.key, 10) - 1 }
  }
  if (!e.shiftKey && e.key === '`') return { kind: 'grid' }
  if (e.shiftKey && platform === 'darwin') return null
  return LETTER_SHORTCUTS[e.key.toLowerCase()] ?? null
}

/** Should the terminal let this key through to the app instead of sending it
 *  to the program? xterm stops every key it turns into input, so the app only
 *  sees what the terminal declines. Plain Ctrl+P / T / B are real terminal
 *  keys and stay with the program; everything else that is an app shortcut
 *  is the app's. */
export function terminalYieldsKey(e: ShortcutKey, platform: InputPlatform): boolean {
  const shortcut = appShortcutOf(e, platform)
  if (!shortcut) return false
  if (shortcut.kind === 'terminal' || shortcut.kind === 'grid') return true
  return platform === 'darwin' || e.shiftKey
}

/** Electron intercepts the DOM paste and Mod+V so main can read images and
 *  file lists off the OS clipboard. A browser cannot do that at all over plain
 *  http (navigator.clipboard is absent in an insecure context), but xterm's
 *  own DOM `paste` handler works everywhere — so the browser page leaves it
 *  alone. */
export function pastePolicy(remote: boolean): { interceptNativePaste: boolean; interceptModV: boolean } {
  return remote
    ? { interceptNativePaste: false, interceptModV: false }
    : { interceptNativePaste: true, interceptModV: true }
}

/** On the browser page, is this keydown the platform's copy or paste shortcut?
 *  Returning false from xterm's key handler for these hands the key to the
 *  browser, whose native copy/paste works over plain http — navigator.clipboard
 *  does not, and xterm would otherwise send Ctrl+V to the PTY as ^V and cancel
 *  the paste. Copy needs a selection: Ctrl+C without one is the interrupt.
 *  Ctrl+Shift+C is left alone — in Chrome it opens the element inspector. */
export function browserClipboardKey(
  e: { type: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  platform: InputPlatform,
  hasSelection: boolean,
): 'copy' | 'paste' | null {
  if (e.type !== 'keydown' || e.altKey) return null
  const mod = platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) return null
  const key = e.key.toLowerCase()
  if (key === 'v') return 'paste'
  if (key === 'c' && !e.shiftKey && hasSelection) return 'copy'
  return null
}

/** The image to upload from a browser paste, or null to let xterm paste text.
 *  Many clipboards carry text and an image together (VS Code, browsers,
 *  Office); text wins, as on the phone UI. */
export function pastedImageFile<F>(
  items: ArrayLike<{ kind: string; type: string; getAsFile(): F | null }>,
): F | null {
  let image: F | null = null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'string' && it.type.startsWith('text/')) return null
    if (!image && it.kind === 'file' && it.type.startsWith('image/')) image = it.getAsFile()
  }
  return image
}
