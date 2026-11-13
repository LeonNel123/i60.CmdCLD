// Request-origin validation for the remote-access server. The server binds
// loopback by default; this guard is the second layer, rejecting requests
// whose Host/Origin point anywhere other than this machine, its own Tailscale
// serve hostname, or (when LAN mode is explicitly enabled) this machine's
// own LAN addresses. DNS rebinding and cross-site WebSocket hijacking both
// arrive with a hostile Host or Origin, so both die here.

export interface RequestGuardOptions {
  lanAccess: boolean
  /** This machine's own IPv4 addresses, lowercase (empty when lanAccess=false). */
  lanAddresses: string[]
  /** This machine's own Tailscale MagicDNS names, lowercase, no trailing dot.
   *  Only these `.ts.net` names pass: anyone can host a public page on some
   *  other `*.ts.net` name (Funnel), and a blanket suffix match let that page
   *  open a socket to localhost and type into every terminal. */
  tailscaleHosts?: string[]
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
  if (name.endsWith('.ts.net')) return (opts.tailscaleHosts ?? []).includes(name)
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

/** True when a rejected request named some `.ts.net` host — worth re-reading
 *  this machine's Tailscale name in case it came up or changed since start. */
export function namesTailscaleHost(hostHeader: string | undefined, originHeader: string | undefined): boolean {
  const names = [hostHeader ? hostHeaderName(hostHeader) : '']
  try { if (originHeader) names.push(new URL(originHeader).hostname.toLowerCase()) } catch {}
  return names.some((n) => n.endsWith('.ts.net'))
}
