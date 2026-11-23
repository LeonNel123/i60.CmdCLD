import { describe, it, expect, vi, afterEach } from 'vitest'
import { RemoteSizeOwner, LOCAL_OWNER } from '../src/main/remote-size-owner'

function make(graceMs = 1500) {
  const announced: string[] = []
  const o = new RemoteSizeOwner({ announce: (owner) => announced.push(owner), graceMs })
  return { o, announced }
}

// One terminal has one size, so one device sets it: the one being used. A
// device that is merely connected (a phone in a pocket, a browser tab in the
// background) used to count, and the desktop window sat passive at whatever
// size its terminals were born with.
describe('RemoteSizeOwner — the device in use owns PTY size', () => {
  afterEach(() => { vi.useRealTimers() })

  it('starts with the desktop window as the owner', () => {
    const { o, announced } = make()
    expect(o.current).toBe(LOCAL_OWNER)
    expect(o.remote).toBe(false)
    expect(announced).toEqual([])
  })

  it('hands the size to a remote device when it is used', () => {
    const { o, announced } = make()
    o.take('phone')
    expect(o.current).toBe('phone')
    expect(o.remote).toBe(true)
    expect(announced).toEqual(['phone'])
  })

  it('says nothing when the owner is used again', () => {
    const { o, announced } = make()
    o.take('phone')
    o.take('phone')
    expect(announced).toEqual(['phone'])
  })

  it('gives it back to the desktop window the moment that is used', () => {
    const { o, announced } = make()
    o.take('phone')
    o.take(LOCAL_OWNER)
    expect(o.remote).toBe(false)
    expect(announced).toEqual(['phone', LOCAL_OWNER])
  })

  it('moves between two remote devices as each is used', () => {
    const { o, announced } = make()
    o.take('phone')
    o.take('browser')
    o.take('phone')
    expect(announced).toEqual(['phone', 'browser', 'phone'])
  })

  it('returns to the desktop window once the owner has been gone for the grace period', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.take('browser')
    o.release('browser')
    expect(o.current).toBe('browser')
    vi.advanceTimersByTime(1499)
    expect(announced).toEqual(['browser'])
    vi.advanceTimersByTime(1)
    expect(announced).toEqual(['browser', LOCAL_OWNER])
    expect(o.current).toBe(LOCAL_OWNER)
  })

  // A browser reload is a disconnect and a reconnect within a second.
  it('keeps the size when the owner comes back inside the grace period', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.take('browser')
    o.release('browser')
    vi.advanceTimersByTime(500)
    o.take('browser')
    vi.advanceTimersByTime(5000)
    expect(announced).toEqual(['browser'])
  })

  it('lets another device take over inside the grace period', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.take('browser')
    o.release('browser')
    o.take('phone')
    vi.advanceTimersByTime(5000)
    expect(announced).toEqual(['browser', 'phone'])
    expect(o.current).toBe('phone')
  })

  it('ignores a device that lets go of a size it does not own', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.take('phone')
    o.release('browser')
    o.release(LOCAL_OWNER)
    vi.advanceTimersByTime(5000)
    expect(announced).toEqual(['phone'])
    expect(o.current).toBe('phone')
  })

  it('reset() (server stopping) returns the size at once when a remote device owned it', () => {
    vi.useFakeTimers()
    const { o, announced } = make(1500)
    o.take('browser')
    o.release('browser')
    o.reset()
    expect(announced).toEqual(['browser', LOCAL_OWNER])
    vi.advanceTimersByTime(5000)
    expect(announced).toEqual(['browser', LOCAL_OWNER])
  })

  it('reset() with the desktop window as owner announces nothing', () => {
    const { o, announced } = make()
    o.reset()
    expect(announced).toEqual([])
  })
})
