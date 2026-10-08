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
  return ok
}
