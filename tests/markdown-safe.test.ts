import { describe, expect, it } from 'vitest'
import { renderMarkdownSafe } from '../src/shared/markdown-safe'

// The viewer puts this HTML into the window that owns window.api — the bridge
// that types into every terminal. A Markdown file is whatever a cloned repo or
// an agent wrote, so nothing in it may become live markup.
describe('renderMarkdownSafe', () => {
  it('renders ordinary Markdown', () => {
    const html = renderMarkdownSafe('# Title\n\nSome **bold** text and `code`.\n\n- a\n- b\n')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<li>a</li>')
  })

  it('shows raw HTML blocks as text', () => {
    const html = renderMarkdownSafe('<script>window.api.writeTerminal("x","rm -rf")</script>\n')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('shows inline HTML as text', () => {
    const html = renderMarkdownSafe('hello <img src=x onerror="alert(1)"> world')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('shows an iframe, a style block and a form as text', () => {
    for (const tag of ['iframe', 'style', 'form', 'object', 'svg']) {
      const html = renderMarkdownSafe(`<${tag}>x</${tag}>\n`)
      expect(html, tag).not.toContain(`<${tag}`)
    }
  })

  it('drops the target of a link that would run script', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'vbscript:x', 'data:text/html,<script>1</script>', 'file:///C:/Windows/system32/calc.exe']) {
      const html = renderMarkdownSafe(`[click](<${href}>)`)
      expect(html, href).not.toMatch(/href=/)
      expect(html, href).toContain('click')
    }
  })

  it('keeps web, mail and in-page links', () => {
    expect(renderMarkdownSafe('[a](https://example.com/x?y=1)')).toContain('href="https://example.com/x?y=1"')
    expect(renderMarkdownSafe('[a](http://example.com)')).toContain('href="http://example.com"')
    expect(renderMarkdownSafe('[a](mailto:me@example.com)')).toContain('href="mailto:me@example.com"')
    expect(renderMarkdownSafe('[a](#section)')).toContain('href="#section"')
  })

  it('drops a relative link, which would navigate the app window', () => {
    const html = renderMarkdownSafe('[other](docs/other.md)')
    expect(html).not.toMatch(/href=/)
    expect(html).toContain('other')
  })

  it('loads images only from the web or inline data', () => {
    expect(renderMarkdownSafe('![logo](https://example.com/a.png)')).toContain('<img src="https://example.com/a.png"')
    expect(renderMarkdownSafe('![x](javascript:alert(1))')).not.toContain('<img')
    expect(renderMarkdownSafe('![x](file:///etc/passwd)')).not.toContain('<img')
  })

  it('escapes a link title and image alt text', () => {
    const html = renderMarkdownSafe('[a](https://example.com "x\\" onmouseover=\\"alert(1)")')
    expect(html).not.toMatch(/ onmouseover="/)
  })

  it('returns an empty string for empty input', () => {
    expect(renderMarkdownSafe('')).toBe('')
  })
})
