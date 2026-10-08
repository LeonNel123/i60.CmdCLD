/** crypto.randomUUID exists only in secure contexts. The remote page is plain
 *  http on a LAN or Tailscale IP, which is not one, and App.tsx mints every
 *  tile id with it. getRandomValues is available everywhere. */
export function installRandomUuidPolyfill(c: { randomUUID?: () => string; getRandomValues: (a: Uint8Array) => Uint8Array }): void {
  if (typeof c.randomUUID === 'function') return
  c.randomUUID = () => {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
}
