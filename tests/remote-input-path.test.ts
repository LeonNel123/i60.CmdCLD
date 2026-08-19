import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// Source-level wiring checks for the remote input and clipboard paths. These cannot be
// exercised without a browser, but the invariants below are the ones that broke in the
// first place, and each is a one-line edit away from regressing.

const root = join(__dirname, '..')
const termView = readFileSync(join(root, 'src', 'remote-ui', 'terminal-view.js'), 'utf-8')
const server = readFileSync(join(root, 'src', 'main', 'remote-server.ts'), 'utf-8')

describe('remote input path', () => {
  // Composed sends must be delayed and paste-wrapped; raw keystrokes must not be.
  // Routing everything through the queued writer would add the submit delay to every
  // keypress and mangle control sequences.
  it('sends composed messages on session:submit, not session:input', () => {
    const send = termView.slice(termView.indexOf('function sendMobileInput'))
      .slice(0, 400)
    expect(send).toContain("emit('session:submit'")
    expect(send).not.toContain("emit('session:input'")
  })

  it('sends quick-action payloads on session:submit', () => {
    const quick = termView.slice(termView.indexOf('var quickBtns')).slice(0, 700)
    expect(quick).toContain("emit('session:submit'")
    expect(quick).not.toContain("emit('session:input'")
    // Quick actions used to bypass the sanitizer entirely.
    expect(quick).toContain('buildSubmitText')
  })

  it('keeps the raw xterm keystroke stream on session:input', () => {
    const onData = termView.slice(termView.indexOf('term.onData(function')).slice(0, 300)
    expect(onData).toContain("emit('session:input'")
    expect(onData).not.toContain('session:submit')
  })

  it('writes keystrokes straight through on the server', () => {
    const handler = server.slice(server.indexOf("socket.on('session:input'")).slice(0, 300)
    expect(handler).toContain('this.ptyManager.write(id, data)')
    expect(handler).not.toContain('submitWriter')
  })

  it('routes submits through the queued writer so the Enter trails the body', () => {
    const handler = server.slice(server.indexOf("socket.on('session:submit'")).slice(0, 400)
    expect(handler).toContain('this.submitWriter.write(id')
    expect(handler).toContain('normalizeSubmitText(text)')
  })
})

describe('remote clipboard path', () => {
  // The remote server is plain http and Tailscale addresses are not localhost, so the
  // page is not a secure context and navigator.clipboard is unavailable. Without the
  // execCommand fallback, copy silently does nothing on exactly that setup.
  it('falls back to execCommand when clipboard API is unavailable', () => {
    expect(termView).toContain('window.isSecureContext')
    expect(termView).toContain("document.execCommand('copy')")
  })

  // Ctrl+C with no selection is the only way to stop a running agent from the keyboard.
  it('keeps Ctrl+C as interrupt when nothing is selected', () => {
    const handler = termView.slice(termView.indexOf('attachCustomKeyEventHandler')).slice(0, 1200)
    expect(handler).toContain('term.hasSelection()')
    expect(handler).toMatch(/hasSelection\(\)[\s\S]{0,160}return false/)
    expect(handler).toMatch(/return true[\s\S]{0,80}\}/)
  })

  it('exposes copyOutput for the header button', () => {
    expect(termView).toContain('copyOutput: copyOutput')
    expect(termView).toContain('term.hasSelection() ? term.getSelection() : bufferText()')
  })
})
