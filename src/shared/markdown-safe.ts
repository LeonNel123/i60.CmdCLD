import { Marked, type Tokens } from 'marked'

// Markdown → HTML for the built-in viewer. The result is inserted into the
// window that holds window.api, so a file must not be able to produce live
// markup: raw HTML is shown as text, and a link or image keeps its target only
// when the scheme is on a short allowlist.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The scheme of a URL as a browser would read it (it ignores leading
 *  whitespace and control characters inside the scheme), or '' if relative. */
function schemeOf(href: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = href.replace(/[\u0000- \u007f-\u009f​-‍﻿]/g, '')
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  return m ? m[1].toLowerCase() : ''
}

const LINK_SCHEMES = new Set(['http', 'https', 'mailto'])

function safeLinkHref(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return trimmed
  return LINK_SCHEMES.has(schemeOf(trimmed)) ? trimmed : null
}

function safeImageSrc(href: string): string | null {
  const trimmed = href.trim()
  const scheme = schemeOf(trimmed)
  if (scheme === 'http' || scheme === 'https') return trimmed
  if (scheme === 'data' && /^data:image\/(png|jpe?g|gif|webp);/i.test(trimmed)) return trimmed
  return null
}

const md = new Marked({
  async: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text)
    },
    link(token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens)
      const href = safeLinkHref(token.href)
      if (href === null) return text
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      return `<a href="${escapeHtml(href)}"${title}>${text}</a>`
    },
    image(token: Tokens.Image): string {
      const src = safeImageSrc(token.href)
      if (src === null) return escapeHtml(token.text)
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${title}>`
    },
  },
})

export function renderMarkdownSafe(markdown: string): string {
  if (!markdown) return ''
  return md.parse(markdown, { async: false }) as string
}
