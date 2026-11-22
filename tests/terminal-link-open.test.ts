import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'url'
import { findTerminalPaths, resolveTerminalPath, terminalLinkAction, shouldFollowLink, linkGestureHint } from '../src/shared/terminal-link'
import { openFileTarget } from '../src/main/open-target'

const texts = (line: string) => findTerminalPaths(line).map((m) => m.text)

// "The agent wrote a spreadsheet — click it and it opens." What stood in the
// way, each found by running the matcher over the kind of line an agent prints.
describe('findTerminalPaths — files an agent reports having written', () => {
  // Only a fixed list of extensions made a bare filename a link, and it was a
  // list of source files: no spreadsheet, document, PDF or image.
  it('links a bare office, PDF or image filename', () => {
    expect(texts('wrote report.xlsx and summary.pdf and data.csv')).toEqual(['report.xlsx', 'summary.pdf', 'data.csv'])
    expect(texts('chart.png notes.docx deck.pptx rows.tsv book.xlsm old.xls')).toEqual([
      'chart.png', 'notes.docx', 'deck.pptx', 'rows.tsv', 'book.xlsm', 'old.xls',
    ])
  })

  // The extension list is an alternation with no boundary after it, so the
  // first alternative that is a prefix won: foo.tsx linked "foo.ts".
  it('links the whole filename, not a shorter extension inside it', () => {
    expect(texts('see foo.tsx and pkg.json and a.jsx')).toEqual(['foo.tsx', 'pkg.json', 'a.jsx'])
    expect(texts('config.yaml style.scss')).toEqual(['config.yaml'])
    expect(texts('page.mdx')).toEqual([])
  })

  // A path at the end of a sentence took the full stop with it, and the file
  // "report.xlsx." does not exist.
  it('leaves sentence punctuation out of the link', () => {
    expect(texts('Saved to D:\\out\\report.xlsx.')).toEqual(['D:\\out\\report.xlsx'])
    expect(texts('see docs/plan.md, then run it')).toEqual(['docs/plan.md'])
    expect(texts('(written to results/final.csv).')).toEqual(['results/final.csv'])
    expect(texts('failed at src/a.ts:12.')).toEqual(['src/a.ts:12'])
    expect(texts('is it out/x.csv?')).toEqual(['out/x.csv'])
  })

  it('keeps the start index when it trims the end', () => {
    expect(findTerminalPaths('ok: out/x.csv.')).toEqual([{ index: 4, text: 'out/x.csv' }])
  })

  // "./build/chart.png" came back as "./" and "build/chart.png".
  it('keeps a ./ or ../ prefix on the path it belongs to', () => {
    expect(texts('./build/chart.png')).toEqual(['./build/chart.png'])
    expect(texts('../shared/data.xlsx')).toEqual(['../shared/data.xlsx'])
  })

  // "~/Documents/x.csv" matched from the slash: "/Documents/x.csv".
  it('keeps the ~ of a home-relative path', () => {
    expect(texts('file at ~/Documents/x.csv')).toEqual(['~/Documents/x.csv'])
  })

  it('still finds what it found before', () => {
    expect(texts('see D:/Source/i60/docs/plan.md here')).toEqual(['D:/Source/i60/docs/plan.md'])
    expect(texts('src/main/index.ts:1186')).toEqual(['src/main/index.ts:1186'])
    expect(texts('README.md')).toEqual(['README.md'])
    expect(texts('version 1.2.3 of e.g. the thing')).toEqual([])
  })
})

describe('resolveTerminalPath — home-relative paths', () => {
  it('joins ~/ onto the home folder', () => {
    expect(resolveTerminalPath('~/Documents/x.csv', 'D:\\proj', 'win32', 'C:\\Users\\me')).toBe('C:\\Users\\me\\Documents/x.csv')
    expect(resolveTerminalPath('~/x.csv:3', '/proj', 'linux', '/home/me')).toBe('/home/me/x.csv')
  })
  it('leaves it relative to the terminal folder when the home folder is unknown', () => {
    expect(resolveTerminalPath('~/x.csv', '/proj', 'linux')).toBe('/proj/~/x.csv')
  })
})

// What a click does with a file, decided by its extension.
describe('terminalLinkAction', () => {
  it('opens Markdown in the viewer and source files in the editor', () => {
    expect(terminalLinkAction('D:\\p\\README.md')).toBe('markdown')
    expect(terminalLinkAction('/p/src/a.ts')).toBe('editor')
    expect(terminalLinkAction('settings.JSON')).toBe('editor')
  })

  it('opens documents, data and images with the default app', () => {
    for (const f of ['report.xlsx', 'data.csv', 'summary.pdf', 'chart.PNG', 'notes.txt', 'page.html', 'noext']) {
      expect(terminalLinkAction(f), f).toBe('default-app')
    }
  })

  // "Open with the default app" on a program runs it. A path in terminal
  // output is not a request to run something, so these are shown in their
  // folder instead.
  it('reveals programs and installers rather than running them', () => {
    for (const f of ['setup.exe', 'run.bat', 'go.CMD', 'a.msi', 'x.lnk', 'y.vbs', 'z.scr', 'tool.jar', 'app.AppImage', 'i.dmg', 'k.reg']) {
      expect(terminalLinkAction(f), f).toBe('reveal')
    }
  })
})

describe('openFileTarget', () => {
  function deps(existing: string[], openError = '') {
    const calls: string[] = []
    return {
      calls,
      d: {
        exists: (p: string) => existing.includes(p),
        openPath: async (p: string) => { calls.push('open ' + p); return openError },
        reveal: (p: string) => { calls.push('reveal ' + p) },
      },
    }
  }

  it('opens an existing file with the default app', async () => {
    const { d, calls } = deps(['D:\\out\\report.xlsx'])
    expect(await openFileTarget('D:\\out\\report.xlsx', d)).toEqual({ ok: true })
    expect(calls).toEqual(['open D:\\out\\report.xlsx'])
  })

  // The click used to do nothing visible: the open failed, the fallback
  // "reveal" of a file that is not there showed nothing, and the renderer
  // ignored the result.
  it('says so when the file does not exist, and opens nothing', async () => {
    const { d, calls } = deps([])
    const r = await openFileTarget('D:\\out\\missing.xlsx', d)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('D:\\out\\missing.xlsx')
    expect(calls).toEqual([])
  })

  // Enforced here too, not only in the renderer: this handler takes whatever
  // path it is sent, including one from a file:// link in program output.
  it('reveals a program instead of running it', async () => {
    const { d, calls } = deps(['D:\\out\\setup.exe'])
    expect(await openFileTarget('D:\\out\\setup.exe', d)).toEqual({ ok: true, revealed: true })
    expect(calls).toEqual(['reveal D:\\out\\setup.exe'])
  })

  it('reveals the file when nothing is set up to open it, and reports why', async () => {
    const { d, calls } = deps(['D:\\out\\data.xyz'], 'No application is associated')
    expect(await openFileTarget('D:\\out\\data.xyz', d)).toEqual({ ok: false, error: 'No application is associated', revealed: true })
    expect(calls).toEqual(['open D:\\out\\data.xyz', 'reveal D:\\out\\data.xyz'])
  })

  it('accepts a file:// URL', async () => {
    const real = process.platform === 'win32' ? 'D:\\out\\my report.pdf' : '/out/my report.pdf'
    const { d, calls } = deps([real])
    expect(await openFileTarget(pathToFileURL(real).href, d)).toEqual({ ok: true })
    expect(calls).toEqual(['open ' + real])
  })

  it('refuses an empty target', async () => {
    const { d } = deps([])
    expect((await openFileTarget('', d)).ok).toBe(false)
    expect((await openFileTarget(undefined, d)).ok).toBe(false)
  })
})

// Which click follows a link. The second half is the part that was missing:
// while the agent tracks the mouse, every click was ignored — and that is the
// state a Claude Code or OpenCode session is in nearly all the time.
describe('shouldFollowLink', () => {
  const click = (keys: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...keys })

  it('needs the shortcut modifier at a plain prompt', () => {
    expect(shouldFollowLink({ mouseTracking: false, mac: false, event: click() })).toBe(false)
    expect(shouldFollowLink({ mouseTracking: false, mac: false, event: click({ ctrlKey: true }) })).toBe(true)
    expect(shouldFollowLink({ mouseTracking: false, mac: true, event: click({ ctrlKey: true }) })).toBe(false)
    expect(shouldFollowLink({ mouseTracking: false, mac: true, event: click({ metaKey: true }) })).toBe(true)
  })

  // Ctrl+click reaches the program too, and Claude Code opens the link
  // itself: following it here as well opened it twice.
  it('leaves a plain Ctrl+click to the program that is tracking the mouse', () => {
    expect(shouldFollowLink({ mouseTracking: true, mac: false, event: click({ ctrlKey: true }) })).toBe(false)
    expect(shouldFollowLink({ mouseTracking: true, mac: true, event: click({ metaKey: true }) })).toBe(false)
  })

  // Shift (Option on a Mac) makes xterm keep the click, so only we see it.
  it('follows the link when the click also carries the key that hides it from the program', () => {
    expect(shouldFollowLink({ mouseTracking: true, mac: false, event: click({ ctrlKey: true, shiftKey: true }) })).toBe(true)
    expect(shouldFollowLink({ mouseTracking: true, mac: true, event: click({ metaKey: true, altKey: true }) })).toBe(true)
    expect(shouldFollowLink({ mouseTracking: true, mac: false, event: click({ shiftKey: true }) })).toBe(false)
    expect(shouldFollowLink({ mouseTracking: true, mac: true, event: click({ metaKey: true, shiftKey: true }) })).toBe(false)
  })

  it('follows an activation with no mouse event only when nothing tracks the mouse', () => {
    expect(shouldFollowLink({ mouseTracking: false, mac: false, event: false })).toBe(true)
    expect(shouldFollowLink({ mouseTracking: true, mac: false, event: false })).toBe(false)
  })
})

describe('linkGestureHint', () => {
  it('names exactly the gesture that works in each state', () => {
    expect(linkGestureHint({ mouseTracking: false, mac: false })).toBe('Ctrl+click to open')
    expect(linkGestureHint({ mouseTracking: true, mac: false })).toBe('Ctrl+Shift+click to open')
    expect(linkGestureHint({ mouseTracking: false, mac: true })).toBe('⌘+click to open')
    expect(linkGestureHint({ mouseTracking: true, mac: true })).toBe('⌘⌥+click to open')
  })
})
