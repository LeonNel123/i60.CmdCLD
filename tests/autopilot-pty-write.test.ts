import { describe, it, expect } from 'vitest'
import { formatPtyWrite } from '../src/main/autopilot/pty-write'

describe('formatPtyWrite', () => {
  it('passes single-line through unchanged', () => {
    expect(formatPtyWrite('hello')).toBe('hello')
  })

  it('passes single-line with trailing \\r through unchanged', () => {
    expect(formatPtyWrite('hello\r')).toBe('hello\r')
  })

  it('passes empty string through unchanged', () => {
    expect(formatPtyWrite('')).toBe('')
  })

  it('passes lone \\r through unchanged', () => {
    expect(formatPtyWrite('\r')).toBe('\r')
  })

  it('wraps multiline body without trailing \\r', () => {
    expect(formatPtyWrite('hello\nworld')).toBe('\x1b[200~hello\nworld\x1b[201~')
  })

  it('wraps multiline body with trailing \\r — \\r stays OUTSIDE the paste end marker', () => {
    expect(formatPtyWrite('hello\nworld\r')).toBe('\x1b[200~hello\nworld\x1b[201~\r')
  })

  it('wraps lone \\n', () => {
    expect(formatPtyWrite('\n')).toBe('\x1b[200~\n\x1b[201~')
  })
})
