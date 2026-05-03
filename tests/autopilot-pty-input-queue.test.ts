import { describe, it, expect, vi } from 'vitest'
import { chunkPtyInput, QueuedPtyWriter } from '../src/main/autopilot/pty-input-queue'

describe('Autopilot PTY input queue', () => {
  it('chunks large formatted writes so the final carriage return is preserved', () => {
    const chunks = chunkPtyInput('hello\nworld\r', { chunkThreshold: 5, chunkSize: 4 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe('\x1b[200~hello\nworld\x1b[201~\r')
    expect(chunks.at(-1)?.endsWith('\r')).toBe(true)
  })

  it('separates multiline paste submit from the bracketed-paste end marker', () => {
    const chunks = chunkPtyInput('hello\nworld\r', { chunkThreshold: 1000 })

    expect(chunks).toEqual(['\x1b[200~hello\nworld\x1b[201~', '\r'])
  })

  it('serializes queued writes for the same terminal without interleaving chunks', async () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const writer = new QueuedPtyWriter((_, data) => writes.push(data), {
        chunkThreshold: 4,
        chunkSize: 4,
        chunkDelayMs: 5,
      })

      writer.write('term-1', 'abcdefghijkl')
      writer.write('term-1', 'XYZ\r')

      expect(writes).toEqual(['abcd'])
      await vi.advanceTimersByTimeAsync(5)
      expect(writes).toEqual(['abcd', 'efgh'])
      await vi.advanceTimersByTimeAsync(5)
      expect(writes).toEqual(['abcd', 'efgh', 'ijkl', 'XYZ\r'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('delays the submit key after a multiline bracketed paste', async () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const writer = new QueuedPtyWriter((_, data) => writes.push(data), {
        chunkThreshold: 1000,
        chunkDelayMs: 5,
        submitDelayMs: 300,
      })

      writer.write('term-1', 'hello\nworld\r')

      expect(writes).toEqual(['\x1b[200~hello\nworld\x1b[201~'])
      await vi.advanceTimersByTimeAsync(299)
      expect(writes).toEqual(['\x1b[200~hello\nworld\x1b[201~'])
      await vi.advanceTimersByTimeAsync(1)
      expect(writes).toEqual(['\x1b[200~hello\nworld\x1b[201~', '\r'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves queued writes only after the delayed submit chunk is written', async () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const writer = new QueuedPtyWriter(
        (_terminalId, data) => {
          writes.push(data)
        },
        { submitDelayMs: 50, chunkDelayMs: 1 },
      )

      let settled = false
      const promise = writer.write('term-1', 'line one\nline two\r').then(() => {
        settled = true
      })
      expect(writes[writes.length - 1]).not.toBe('\r')

      await vi.advanceTimersByTimeAsync(49)
      await Promise.resolve()

      expect(settled).toBe(false)
      expect(writes[writes.length - 1]).not.toBe('\r')

      await vi.advanceTimersByTimeAsync(1)
      await promise

      expect(settled).toBe(true)
      expect(writes[writes.length - 1]).toBe('\r')
    } finally {
      vi.useRealTimers()
    }
  })
})
