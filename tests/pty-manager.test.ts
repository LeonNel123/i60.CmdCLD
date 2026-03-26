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
