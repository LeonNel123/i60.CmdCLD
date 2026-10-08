import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '..', 'src', 'renderer')
const index = readFileSync(join(dir, 'index.html'), 'utf-8')
const remote = readFileSync(join(dir, 'remote.html'), 'utf-8')

function styleBlock(html: string): string {
  const s = html.indexOf('<style>')
  const e = html.indexOf('</style>', s)
  return html.slice(s, e + '</style>'.length).replace(/\r\n/g, '\n')
}

describe('remote.html (the /desktop page)', () => {
  it('carries exactly the same base styles as index.html so the two pages cannot drift', () => {
    expect(styleBlock(remote)).toBe(styleBlock(index))
  })
  it('loads the socket.io client from the server before the module entry', () => {
    const io = remote.indexOf('<script src="/socket.io/socket.io.js"></script>')
    const entry = remote.indexOf('<script type="module" src="./src/remote-main.tsx"></script>')
    expect(io).toBeGreaterThan(-1)
    expect(entry).toBeGreaterThan(io)
  })
  it('has its own title', () => {
    expect(remote).toContain('<title>CmdCLD Remote</title>')
  })
})

describe('page-select wiring', () => {
  const mobile = readFileSync(join(__dirname, '..', 'src', 'remote-ui', 'index.html'), 'utf-8')
  it('both pages load page-select.js and run it before their own scripts', () => {
    for (const [html, page] of [[mobile, 'mobile'], [remote, 'desktop']] as const) {
      const lib = html.indexOf('<script src="/page-select.js"></script>')
      expect(lib, page).toBeGreaterThan(-1)
      expect(html.indexOf(`CmdCLD_PageSelect.apply('${page}')`), page).toBeGreaterThan(lib)
    }
  })
})
