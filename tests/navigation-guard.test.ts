import { describe, expect, it } from 'vitest'
import { navigationDecision } from '../src/main/navigation-guard'

// The app window carries the preload bridge. Whatever page it shows can type
// into every terminal, so it may only ever show the app's own page.
describe('navigationDecision', () => {
  const packaged = 'file:///C:/Users/me/AppData/Local/Programs/CmdCLD/resources/app.asar/out/renderer/index.html'
  const dev = 'http://localhost:5173/'

  it('allows the app page itself, with any query or hash', () => {
    expect(navigationDecision(packaged, packaged)).toBe('allow')
    expect(navigationDecision(packaged + '?empty=1', packaged)).toBe('allow')
    expect(navigationDecision(packaged + '#x', packaged + '?empty=1')).toBe('allow')
    expect(navigationDecision(dev, dev)).toBe('allow')
    expect(navigationDecision('http://localhost:5173/?empty=1', dev)).toBe('allow')
  })

  it('sends a web page to the browser instead of loading it in the window', () => {
    expect(navigationDecision('https://example.com/', packaged)).toBe('external')
    expect(navigationDecision('http://example.com/a?b=c', dev)).toBe('external')
  })

  it('treats another local port or path as a web page, not as the app', () => {
    expect(navigationDecision('http://localhost:3000/', dev)).toBe('external')
    expect(navigationDecision('http://localhost:5173/other.html', dev)).toBe('external')
  })

  // What a file dropped outside a tile does: the window navigates to it.
  it('refuses any other file', () => {
    expect(navigationDecision('file:///C:/Users/me/Downloads/page.html', packaged)).toBe('deny')
    expect(navigationDecision('file:///C:/Users/me/AppData/Local/Programs/CmdCLD/resources/app.asar/out/renderer/remote.html', packaged)).toBe('deny')
  })

  it('refuses every other scheme and anything unparseable', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'about:blank', 'chrome://gpu', 'blob:x', 'ms-settings:', '', 'not a url']) {
      expect(navigationDecision(url, packaged), url).toBe('deny')
    }
  })

  it('refuses everything when the app page is not known', () => {
    expect(navigationDecision(packaged, '')).toBe('deny')
  })
})
