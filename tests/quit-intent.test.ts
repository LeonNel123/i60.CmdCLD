import { describe, expect, it } from 'vitest'
import { createQuitIntent } from '../src/main/quit-intent'

// Cmd+Q on a Mac: the app is asked to quit, each window is asked to close, and
// a window with live terminals answers "wait" while it shows its confirmation.
// That refusal cancels the quit, so once the person confirms, the app has to
// remember they were quitting.
describe('quit intent', () => {
  it('is inactive until a quit is requested', () => {
    expect(createQuitIntent().active()).toBe(false)
  })

  it('stays active after a request, so a confirmed window close continues the quit', () => {
    let t = 1000
    const q = createQuitIntent({ now: () => t })
    q.request()
    t += 30_000
    expect(q.active()).toBe(true)
  })

  // Cancelling the confirmation tells main nothing. Without an expiry, closing
  // the last window an hour later would quit the app instead of leaving it in
  // the dock.
  it('lapses when the person does not go through with it', () => {
    let t = 1000
    const q = createQuitIntent({ now: () => t, ttlMs: 60_000 })
    q.request()
    t += 60_001
    expect(q.active()).toBe(false)
  })

  it('can be cleared', () => {
    const q = createQuitIntent()
    q.request()
    q.clear()
    expect(q.active()).toBe(false)
  })
})
