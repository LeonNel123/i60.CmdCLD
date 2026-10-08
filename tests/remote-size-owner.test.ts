import { describe, it, expect } from 'vitest'
import { RemoteSizeOwner } from '../src/main/remote-size-owner'

describe('RemoteSizeOwner — who owns PTY size', () => {
  it('reports a transition to remote on the first desktop client and back on the last', () => {
    const o = new RemoteSizeOwner()
    expect(o.count).toBe(0)
    expect(o.connect(true)).toBe('remote')
    expect(o.connect(true)).toBeNull()
    expect(o.count).toBe(2)
    expect(o.disconnect(true)).toBeNull()
    expect(o.disconnect(true)).toBe('local')
    expect(o.count).toBe(0)
  })

  it('ignores phone clients entirely', () => {
    const o = new RemoteSizeOwner()
    expect(o.connect(false)).toBeNull()
    expect(o.disconnect(false)).toBeNull()
    expect(o.count).toBe(0)
  })

  it('never goes negative on a stray disconnect', () => {
    const o = new RemoteSizeOwner()
    expect(o.disconnect(true)).toBeNull()
    expect(o.count).toBe(0)
  })
})
