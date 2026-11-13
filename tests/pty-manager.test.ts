import { describe, it, expect } from 'vitest'
import { ScrollbackBuffer } from '../src/main/pty-manager'

describe('ScrollbackBuffer', () => {
  it('stores and retrieves data', () => {
    const buf = new ScrollbackBuffer(100)
    buf.push('hello\n')
    buf.push('world\n')
    expect(buf.getAll()).toBe('hello\nworld\n')
  })

  it('respects max size by dropping old data', () => {
    const buf = new ScrollbackBuffer(20)
    buf.push('a'.repeat(15))
    buf.push('b'.repeat(10))
    const result = buf.getAll()
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result).toContain('b'.repeat(10))
  })

  it('handles empty buffer', () => {
    const buf = new ScrollbackBuffer(100)
    expect(buf.getAll()).toBe('')
  })

  it('clears buffer', () => {
    const buf = new ScrollbackBuffer(100)
    buf.push('data')
    buf.clear()
    expect(buf.getAll()).toBe('')
  })
})

describe('PtyManager.kill', () => {
  // The exit listener is disposed before the kill, so without 'killed' the
  // remote clients never heard that a closed session was gone.
  it("emits 'killed' (not 'exit') once the session is removed", async () => {
    const { PtyManager } = await import('../src/main/pty-manager')
    const m = new PtyManager()
    const events: string[] = []
    m.on('killed', ({ id }: { id: string }) => events.push(`killed:${id}:${m.has(id)}`))
    m.on('exit', () => events.push('exit'))
    ;(m as any).ptys.set('t1', {
      flushTimer: null, pendingData: '', webContents: { isDestroyed: () => true },
      dataDisposable: { dispose() {} }, exitDisposable: { dispose() {} }, process: { kill() {} },
    })
    m.kill('t1')
    m.kill('t1') // second kill is a no-op
    expect(events).toEqual(['killed:t1:false'])
  })
})
