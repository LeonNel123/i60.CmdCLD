import { describe, it, expect, vi } from 'vitest'

interface FakeWindow {
  id: number
  webContents: { id: number; isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
  isDestroyed: () => boolean
  getBounds: () => { x: number; y: number; width: number; height: number }
}

function makeFakeWindow(id: number): FakeWindow {
  return {
    id,
    webContents: { id, isDestroyed: () => false, send: vi.fn() },
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  }
}

describe('WindowRegistry', () => {
  it('registers a window and assigns label "Window 1"', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    const fw = makeFakeWindow(1)
    reg.register('win-1', fw as any)
    const list = reg.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({ id: 'win-1', label: 'Window 1' })
  })

  it('assigns sequential labels', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    reg.register('a', makeFakeWindow(1) as any)
    reg.register('b', makeFakeWindow(2) as any)
    const list = reg.list()
    expect(list.map((w) => w.label)).toEqual(['Window 1', 'Window 2'])
  })

  it('reuses labels after unregister', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    reg.register('a', makeFakeWindow(1) as any)
    reg.register('b', makeFakeWindow(2) as any)
    reg.unregister('a')
    reg.register('c', makeFakeWindow(3) as any)
    const labels = reg.list().map((w) => w.label)
    expect(labels).toContain('Window 1')
    expect(labels).toContain('Window 2')
  })

  it('getWebContents returns correct webContents', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    const fw = makeFakeWindow(42)
    reg.register('x', fw as any)
    expect(reg.getWebContents('x')).toBe(fw.webContents)
  })

  it('getWebContents returns undefined for unknown id', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    expect(reg.getWebContents('nope')).toBeUndefined()
  })

  it('listExcluding filters out the given id', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    reg.register('a', makeFakeWindow(1) as any)
    reg.register('b', makeFakeWindow(2) as any)
    const list = reg.listExcluding('a')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('b')
  })

  it('broadcastExcept sends to all windows except the excluded one', async () => {
    const { WindowRegistry } = await import('../src/main/window-registry')
    const reg = new WindowRegistry()
    const fw1 = makeFakeWindow(1)
    const fw2 = makeFakeWindow(2)
    reg.register('a', fw1 as any)
    reg.register('b', fw2 as any)
    reg.broadcastExcept('a', 'test-channel', { data: 1 })
    expect(fw1.webContents.send).not.toHaveBeenCalled()
    expect(fw2.webContents.send).toHaveBeenCalledWith('test-channel', { data: 1 })
  })
})
