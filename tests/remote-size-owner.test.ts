import { describe, it, expect, vi, afterEach } from 'vitest'
import { RemoteSizeOwner } from '../src/main/remote-size-owner'

function make(graceMs = 1500) {
  const announced: string[] = []
  const o = new RemoteSizeOwner({ announce: (owner) => announced.push(owner), graceMs })
  return { o, announced }
}

describe('RemoteSizeOwner — who owns PTY size', () => {
  afterEach(() => { vi.useRealTimers() })

  it('announces remote on the first desktop client, and local only after the last one has been gone for the grace period', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.connect(true)
    expect(announced).toEqual(['remote'])
    o.connect(true)
    o.disconnect(true)
    expect(announced).toEqual(['remote'])
    o.disconnect(true)
    expect(o.count).toBe(0)
    expect(announced).toEqual(['remote'])
    vi.advanceTimersByTime(1499)
    expect(announced).toEqual(['remote'])
    vi.advanceTimersByTime(1)
    expect(announced).toEqual(['remote', 'local'])
  })

  it('a reconnect inside the grace period never flips ownership', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.connect(true)
    o.disconnect(true)
    vi.advanceTimersByTime(500)
    o.connect(true)
    vi.advanceTimersByTime(5000)
    expect(announced).toEqual(['remote'])
    expect(o.count).toBe(1)
  })

  it('reset() (server stopping) announces local immediately when remote owned the size', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.connect(true)
    o.reset()
    expect(announced).toEqual(['remote', 'local'])
    expect(o.count).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(announced).toEqual(['remote', 'local'])
  })

  it('reset() with no remote owner announces nothing', () => {
    const { o, announced } = make()
    o.reset()
    expect(announced).toEqual([])
  })

  it('ignores phone clients entirely', () => {
    const { o, announced } = make()
    o.connect(false)
    o.disconnect(false)
    expect(o.count).toBe(0)
    expect(announced).toEqual([])
  })

  it('never goes negative on a stray disconnect', () => {
    const { o, announced } = make()
    o.disconnect(true)
    expect(o.count).toBe(0)
    expect(announced).toEqual([])
  })
})
