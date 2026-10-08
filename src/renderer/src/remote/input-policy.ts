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
