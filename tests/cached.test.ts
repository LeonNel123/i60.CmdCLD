import { describe, expect, it } from 'vitest'
import { cachedFor } from '../src/main/cached'

// The editor and agent-CLI probes shell out synchronously (where, vswhere) on
// the main thread, and were run on every tile mount and every settings fetch:
// restoring ten tiles froze every terminal for seconds.
describe('cachedFor', () => {
  it('computes once and reuses the value within the time limit', () => {
    let t = 0, calls = 0
    const get = cachedFor(() => ++calls, 1000, () => t)
    expect(get()).toBe(1)
    t = 999
    expect(get()).toBe(1)
    expect(calls).toBe(1)
  })

  it('computes again once the value is too old', () => {
    let t = 0, calls = 0
    const get = cachedFor(() => ++calls, 1000, () => t)
    get()
    t = 1001
    expect(get()).toBe(2)
  })

  it('computes again on demand', () => {
    let calls = 0
    const get = cachedFor(() => ++calls, 1000, () => 0)
    get()
    expect(get.refresh()).toBe(2)
    expect(get()).toBe(2)
  })

  it('does not keep a failure', () => {
    let fail = true
    const get = cachedFor(() => { if (fail) throw new Error('x'); return 'ok' }, 1000, () => 0)
    expect(() => get()).toThrow('x')
    fail = false
    expect(get()).toBe('ok')
  })
})
