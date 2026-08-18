// Request-origin validation for the remote-access server. The server binds
// loopback by default; this guard is the second layer, rejecting requests
// whose Host/Origin point anywhere other than this machine, a Tailscale
// serve hostname, or (when LAN mode is explicitly enabled) this machine's
// own LAN addresses. DNS rebinding and cross-site WebSocket hijacking both
// arrive with a hostile Host or Origin, so both die here.

export interface RequestGuardOptions {
  lanAccess: boolean
  /** This machine's own IPv4 addresses, lowercase (empty when lanAccess=false). */
  lanAddresses: string[]
}

/** Hostname from a Host header value: strips the port, unwraps IPv6 brackets. */
function hostHeaderName(header: string): string {
  const h = header.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end > 0 ? h.slice(1, end) : ''
  }
  return h.split(':')[0]
}

function isAllowedHostname(name: string, opts: RequestGuardOptions): boolean {
  if (!name) return false
  if (name === 'localhost' || name === '127.0.0.1' || name === '::1') return true
  if (name.endsWith('.ts.net')) return true
  return opts.lanAccess && opts.lanAddresses.includes(name)
}

export function isRequestAllowed(
  hostHeader: string | undefined,
  originHeader: string | undefined,
  opts: RequestGuardOptions,
): boolean {
  if (!hostHeader || !isAllowedHostname(hostHeaderName(hostHeader), opts)) return false
  if (originHeader !== undefined) {
    let originName: string
    try {
      originName = new URL(originHeader).hostname.toLowerCase()
    } catch {
      return false // covers "Origin: null" and malformed values
    }
    if (!isAllowedHostname(originName.replace(/^\[|\]$/g, ''), opts)) return false
  }
  return true
}
