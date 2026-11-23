// Where the app window is allowed to go. The window carries the preload
// bridge, so any page it loads can type into every terminal: it may only ever
// show the app's own page. A web link is handed to the browser; everything
// else (a dropped file, another file under the app folder, any other scheme)
// is refused.

export type NavigationDecision = 'allow' | 'external' | 'deny'

function pageIdentity(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return null
  }
}

export function navigationDecision(targetUrl: string, appUrl: string): NavigationDecision {
  const target = pageIdentity(targetUrl)
  if (target === null) return 'deny'
  const app = pageIdentity(appUrl)
  if (app !== null && target === app) return 'allow'
  const protocol = new URL(targetUrl).protocol
  return protocol === 'http:' || protocol === 'https:' ? 'external' : 'deny'
}
