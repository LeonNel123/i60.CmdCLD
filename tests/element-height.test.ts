import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHeightTracker } from '../src/renderer/src/utils/element-height'

/** Minimal stand-in for a DOM element with an observable height. */
function fakeEl(height: number) {
  const el = {
    height,
    getBoundingClientRect: () => ({ height: el.height }),
  }
  return el as unknown as HTMLElement & { height: number }
}

/** Records observers so a test can fire them the way the browser would. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: unknown[] = []
  disconnected = false
  constructor(public cb: () => void) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: unknown): void { this.observed.push(el) }
  disconnect(): void { this.disconnected = true }
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  ;(globalThis as any).ResizeObserver = FakeResizeObserver
})
afterEach(() => {
  delete (globalThis as any).ResizeObserver
})

describe('createHeightTracker', () => {
  it('measures immediately when the element attaches', () => {
    const seen: number[] = []
    const track = createHeightTracker((h) => seen.push(h))
    track(fakeEl(800))
    expect(seen).toEqual([800])
    expect(FakeResizeObserver.instances).toHaveLength(1)
  })

  it('reports the new height when the element is resized', () => {
    const seen: number[] = []
    const track = createHeightTracker((h) => seen.push(h))
    const el = fakeEl(800)
    track(el)
    el.height = 620   // broadcast bar opened underneath
    FakeResizeObserver.instances[0].cb()
    expect(seen).toEqual([800, 620])
  })

  // The regression this exists for: App renders a loading screen first, so the
  // grid area is absent from the tree on the first render. An effect with []
  // deps saw a null ref and never observed anything, leaving the grid sized off
  // window.innerHeight — its tiles ran under the broadcast bar.
  it('still observes an element that only attaches on a later render', () => {
    const seen: number[] = []
    const track = createHeightTracker((h) => seen.push(h))
    track(null)                       // first render: loading screen, no grid area
    expect(FakeResizeObserver.instances).toHaveLength(0)
    const el = fakeEl(740)
    track(el)                         // grid area mounts once state has loaded
    expect(seen).toEqual([740])
    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect(FakeResizeObserver.instances[0].observed).toEqual([el])
  })

  it('disconnects the old observer when the element is swapped or detached', () => {
    const track = createHeightTracker(() => {})
    track(fakeEl(800))
    track(fakeEl(500))
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
    expect(FakeResizeObserver.instances[1].disconnected).toBe(false)
    track(null)
    expect(FakeResizeObserver.instances[1].disconnected).toBe(true)
  })

  it('ignores a zero height, which is what a hidden or unlaid-out box reports', () => {
    const seen: number[] = []
    const track = createHeightTracker((h) => seen.push(h))
    track(fakeEl(0))
    expect(seen).toEqual([])
  })
})
