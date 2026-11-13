/** Clipboard write that also works over plain http (not a secure context, so
 *  navigator.clipboard is absent). Ported from remote-ui/terminal-view.js. */
export function copyText(text: string): boolean {
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && (globalThis as any).isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
      return true
    }
  } catch {}
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  // select() moves focus to the temporary textarea; without handing it back,
  // a terminal stops receiving keystrokes after every copy.
  const previous = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', 'readonly')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  let ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    ok = document.execCommand('copy')
  } catch {}
  document.body.removeChild(ta)
  try { previous?.focus({ preventScroll: true }) } catch {}
  return ok
}

/** Ready xterm's hidden textarea for the browser's native copy: put the
 *  selection in it and select it, so a browser that only copies a real DOM
 *  selection still copies the text. xterm's own `copy` listener sets
 *  clipboardData from its selection as well. Focus never moves, so typing
 *  carries on. The value is cleared once the copy has run. */
export function primeNativeCopy(textarea: HTMLTextAreaElement | null | undefined, text: string): void {
  if (!textarea || !text) return
  textarea.value = text
  textarea.select()
  setTimeout(() => { textarea.value = '' }, 0)
}
