import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'src', 'remote-ui', 'style.css'), 'utf-8')
const html = readFileSync(join(__dirname, '..', 'src', 'remote-ui', 'index.html'), 'utf-8')
const appJs = readFileSync(join(__dirname, '..', 'src', 'remote-ui', 'app.js'), 'utf-8')

function terminalHeaderHtml() {
  const start = html.indexOf('<header id="terminal-header">')
  const end = html.indexOf('</header>', start)
  return html.slice(start, end)
}

function quickActionsHtml() {
  const match = html.match(/<div id="quick-actions">([\s\S]*?)\r?\n\s*<\/div>\r?\n\s*<div id="mobile-input-bar">/)
  return match ? match[1] : ''
}

describe('remote dashboard layout', () => {
  it('pins the mobile landing-page action bar inside the visible viewport', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*#dashboard-view\s*\{[\s\S]*height:\s*100dvh;[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*0;/)
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*#new-session-bar\s*\{[\s\S]*padding-bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\);/)
  })

  it('keeps the mobile terminal header compact', () => {
    const header = terminalHeaderHtml()
    const quickActions = quickActionsHtml().trim()

    expect(header).toMatch(/<button id="back-btn"[^>]*aria-label="Back to sessions"[^>]*>/)
    expect(header).not.toContain('← Back')
    expect(header).not.toContain('id="help-btn"')
    expect(header).not.toContain('id="new-from-terminal-btn"')
    expect(quickActions).toMatch(/<button id="help-btn" class="quick-btn quick-help-btn"[^>]*>[\s\S]*<svg[\s\S]*<\/button>$/)
  })

  it('renders terminal activity as a color-coded dot without status text', () => {
    expect(appJs).toMatch(/function renderTerminalStatus\(id\)/)
    expect(appJs).toMatch(/terminalStatus\.textContent = '●'/)
    expect(appJs).toMatch(/terminalStatus\.className = 'terminal-status-dot ' \+ \(busy \? 'busy' : 'idle'\)/)
    expect(css).toMatch(/#back-btn\s*\{[\s\S]*width:\s*36px;[\s\S]*height:\s*36px;/)
    expect(css).toMatch(/#terminal-status\.terminal-status-dot\s*\{[\s\S]*font-size:\s*14px;/)
  })

  it('uses the desktop app visual tokens and icon controls', () => {
    expect(css).toMatch(/body\s*\{[\s\S]*background:\s*#1e1e1e;/)
    expect(css).toMatch(/#status-bar\s*\{[\s\S]*background:\s*#181818;[\s\S]*border-bottom:\s*1px solid #2d2d2d;/)
    expect(css).toMatch(/#terminal-header\s*\{[\s\S]*background:\s*#252526;[\s\S]*border-bottom:\s*1px solid #2d2d2d;/)
    expect(css).toMatch(/\.btn-primary\s*\{[\s\S]*background:\s*#22c55e;[\s\S]*color:\s*#000;/)
    expect(html).toMatch(/<button id="new-session-btn" class="btn-primary icon-label-btn">[\s\S]*<svg[\s\S]*<span>New Session<\/span>/)
    expect(html).toMatch(/<a href="\/setup\.html" class="setup-link"[\s\S]*<svg/)
    expect(html).toMatch(/<button id="ctrl-c-btn" class="btn-small icon-only-btn"[\s\S]*<svg/)
    expect(html).toMatch(/<button id="kill-btn" class="btn-small btn-danger icon-only-btn"[\s\S]*<svg/)
    expect(html).toMatch(/<button id="mobile-send-btn" class="btn-primary icon-label-btn"[\s\S]*<svg/)
    expect(html).toMatch(/<label id="mobile-image-btn" class="btn-icon icon-only-btn"[\s\S]*<svg/)
  })
})
