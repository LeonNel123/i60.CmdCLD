import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const phone = require('../src/remote-ui/phone-helpers.js')

const ui = join(__dirname, '..', 'src', 'remote-ui')
const read = (name: string) => readFileSync(join(ui, name), 'utf-8')
const html = read('index.html')
const css = read('style.css')
const appJs = read('app.js')
const termView = read('terminal-view.js')

describe('phone key row', () => {
  const row = (html.match(/<div id="key-row"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''
  const keys = [...row.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1])

  // Agent menus and permission prompts take Esc, arrows, Tab and a bare Enter;
  // the composer can only send text followed by Enter.
  it('offers the keys a menu needs', () => {
    expect(keys).toEqual(['esc', 'tab', 'shift-tab', 'left', 'up', 'down', 'right', 'enter'])
  })

  it('has a byte sequence for every key it shows', () => {
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(phone.keySequence(key), key).not.toBeNull()
  })

  it('labels every key for a screen reader', () => {
    const buttons = [...row.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    expect(buttons).toHaveLength(keys.length)
    for (const b of buttons) expect(b).toMatch(/aria-label="[^"]+"/)
  })

  it('sits between the output and the quick actions, phone layout only', () => {
    const mobile = html.slice(html.indexOf('<div id="mobile-terminal">'))
    expect(mobile.indexOf('id="mobile-output"')).toBeLessThan(mobile.indexOf('id="key-row"'))
    expect(mobile.indexOf('id="key-row"')).toBeLessThan(mobile.indexOf('id="quick-actions"'))
  })

  // Keys are raw input. Through session:submit they would be queued, wrapped
  // and followed by an Enter of their own.
  it('sends keys as raw input, never as a composed message', () => {
    const handler = termView.slice(termView.indexOf("querySelectorAll('.key-btn')")).slice(0, 900)
    expect(handler).toContain('keySequence(')
    expect(handler).toContain("emit('session:input'")
    expect(handler).not.toContain('session:submit')
  })

  // A tap on a button moves focus to it; with the composer focused that would
  // drop the on-screen keyboard between every arrow press.
  it('does not take focus from the composer', () => {
    const handler = termView.slice(termView.indexOf("querySelectorAll('.key-btn')")).slice(0, 900)
    expect(handler).toMatch(/addEventListener\('mousedown',[\s\S]*preventDefault\(\)/)
  })

  it('lays the keys out in one row of equal buttons', () => {
    expect(css).toMatch(/#key-row\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-shrink:\s*0;/)
    expect(css).toMatch(/\.key-btn\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*min-height:\s*36px;/)
  })
})

describe('fit to phone', () => {
  it('has a toggle in the terminal header, phone layout only', () => {
    const start = html.indexOf('<header id="terminal-header">')
    const header = html.slice(start, html.indexOf('</header>', start))
    expect(header).toMatch(/<button id="fit-btn" class="btn-small mobile-only"[^>]*aria-pressed="false"/)
  })

  it('claims PTY size ownership while fitting and releases it on close', () => {
    expect(termView).toContain("emit('size:claim', { on: true })")
    const close = termView.slice(termView.indexOf('function close()')).slice(0, 900)
    expect(close).toContain('releaseSize()')
    expect(termView).toMatch(/function releaseSize\(\)[\s\S]{0,300}emit\('size:claim', \{ on: false \}\)/)
  })

  // One terminal has one size and the device being used sets it. When the PC
  // is used it takes the size back; the phone must then mirror, not fit —
  // every keyboard pop-up would otherwise resize the terminal under the
  // person typing at the PC.
  it('stops fitting when another device takes the size', () => {
    expect(appJs).toMatch(/socket\.on\('size:owner'[\s\S]{0,200}CmdCLD_Terminal\.onSizeOwner\(/)
    expect(termView).toContain('onSizeOwner: onSizeOwner')
    const notice = termView.slice(termView.indexOf('function onSizeOwner(')).slice(0, 300)
    expect(notice).toContain('sizeLost = true')
    const fit = termView.slice(termView.indexOf('function fitToPhone()')).slice(0, 200)
    expect(fit).toContain('sizeLost')
  })

  it('takes the size back when the phone is touched again', () => {
    const reclaim = termView.slice(termView.indexOf('function reclaimSize(')).slice(0, 400)
    expect(reclaim).toContain('claimSize()')
    expect(reclaim).toContain('fitToPhone()')
    expect(termView).toMatch(/addEventListener\('pointerdown', reclaimSize, true\)/)
    // Leaving the terminal is not using it.
    expect(reclaim).toContain("closest('#back-btn')")
  })

  it('sizes through the tested rule', () => {
    expect(termView).toContain('CmdCLD_Phone.fitDims(')
  })

  // Found in a browser: xterm measured its cell with the fallback font, the
  // web font arrived a moment later with a wider, taller cell, and the first
  // fit asked for 53x34 on a screen that holds 52x30.
  it('does not fit until the terminal font has loaded and been re-measured', () => {
    const fit = termView.slice(termView.indexOf('function fitToPhone()')).slice(0, 200)
    expect(fit).toContain('!fontsReady')
    expect(termView).toContain("document.fonts.load(\"12px 'JetBrains Mono'\")")
    const ready = termView.slice(termView.indexOf('var onFonts = function')).slice(0, 200)
    expect(ready.indexOf('remeasureCell()')).toBeGreaterThan(-1)
    expect(ready.indexOf('remeasureCell()')).toBeLessThan(ready.indexOf('fitToPhone()'))
  })
})

describe('phone session list', () => {
  it('loads the helpers before the scripts that use them', () => {
    const helpers = html.indexOf('<script src="/phone-helpers.js">')
    expect(helpers).toBeGreaterThan(-1)
    expect(helpers).toBeLessThan(html.indexOf('<script src="/app.js">'))
    expect(helpers).toBeLessThan(html.indexOf('<script src="/terminal-view.js">'))
  })

  it('takes activity from the server instead of counting output', () => {
    expect(appJs).toContain("socket.on('session:activity'")
    expect(appJs).not.toContain('trackBusy(')
  })

  it('asks for the output of the open terminal only', () => {
    expect(appJs).toContain("emit('session:watch', { id: id })")
    expect(appJs).toContain("emit('session:watch', { id: null })")
  })

  it('orders the list for triage', () => {
    expect(appJs).toContain('CmdCLD_Phone.sortForTriage(')
    expect(css).toMatch(/\.status-label\.unseen\s*\{/)
  })

  it('opens a session as soon as it has been created', () => {
    const create = appJs.slice(appJs.indexOf('function openOrCreateSession')).slice(0, 1800)
    expect(create).toMatch(/r\.json\(\)[\s\S]*openTerminal\(/)
  })
})

describe('phone navigation', () => {
  // Without a history entry the Back gesture leaves the page instead of
  // returning to the session list.
  it('puts the open terminal in browser history', () => {
    expect(appJs).toContain('history.pushState(')
    expect(appJs).toContain("window.addEventListener('popstate'")
    expect(appJs).toContain('CmdCLD_Phone.sessionFromHash(')
  })
})

describe('home-screen install', () => {
  it('links a manifest and an Apple touch icon', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest">/)
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/)
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes">/)
    expect(html).toMatch(/<meta name="theme-color" content="#181818">/)
  })

  it('ships a manifest whose icons exist', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'))
    expect(manifest.name).toBe('CmdCLD Remote')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512'])
    for (const icon of manifest.icons) {
      expect(existsSync(join(ui, icon.src)), icon.src).toBe(true)
    }
    expect(existsSync(join(ui, 'icons', 'apple-touch-icon.png'))).toBe(true)
  })
})
