import { describe, it, expect } from 'vitest'

// Load the remote-ui sanitizer. It's a browser IIFE that also exports via
// CommonJS when `module` is defined, which vitest sets up for us.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hasNewline, buildSendPayload } = require('../src/remote-ui/input-sanitizer.js')

describe('remote input sanitizer', () => {
  describe('hasNewline', () => {
    it('returns false for null/undefined', () => {
      expect(hasNewline(null)).toBe(false)
      expect(hasNewline(undefined)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(hasNewline('')).toBe(false)
    })

    it('returns false for plain text', () => {
      expect(hasNewline('hello world')).toBe(false)
    })

    it('returns true for text containing \\n', () => {
      expect(hasNewline('hello\n')).toBe(true)
      expect(hasNewline('\nhello')).toBe(true)
      expect(hasNewline('he\nllo')).toBe(true)
    })

    it('returns true for text containing \\r', () => {
      expect(hasNewline('hello\r')).toBe(true)
    })

    it('returns true for just a newline', () => {
      expect(hasNewline('\n')).toBe(true)
      expect(hasNewline('\r')).toBe(true)
    })
  })

  describe('buildSendPayload', () => {
    it('returns null for empty input', () => {
      expect(buildSendPayload('')).toBeNull()
      expect(buildSendPayload(null)).toBeNull()
      expect(buildSendPayload(undefined)).toBeNull()
    })

    it('returns null when input is only newlines (nothing real to send)', () => {
      expect(buildSendPayload('\n')).toBeNull()
      expect(buildSendPayload('\r\n')).toBeNull()
      expect(buildSendPayload('\n\n\n')).toBeNull()
    })

    it('appends \\r to plain text', () => {
      expect(buildSendPayload('hello')).toBe('hello\r')
      expect(buildSendPayload('npm run dev')).toBe('npm run dev\r')
    })

    it('converts a trailing \\n to \\r (Samsung Enter injection)', () => {
      expect(buildSendPayload('hello\n')).toBe('hello\r')
    })

    it('converts \\r\\n to a single \\r (Windows line endings)', () => {
      expect(buildSendPayload('hello\r\n')).toBe('hello\r')
    })

    it('preserves multi-line paste as multiple terminal commands', () => {
      // Two lines pasted should execute both, each with its own Enter.
      expect(buildSendPayload('line1\nline2')).toBe('line1\rline2\r')
      expect(buildSendPayload('line1\r\nline2')).toBe('line1\rline2\r')
      expect(buildSendPayload('line1\nline2\nline3')).toBe('line1\rline2\rline3\r')
    })

    it('strips leading blank lines', () => {
      expect(buildSendPayload('\nhello')).toBe('hello\r')
      expect(buildSendPayload('\n\nhello')).toBe('hello\r')
    })

    it('strips trailing blank lines', () => {
      expect(buildSendPayload('hello\n\n')).toBe('hello\r')
    })

    it('handles the Samsung long-text case', () => {
      const long = 'This is a long command that Samsung might inject a newline into\n'
      expect(buildSendPayload(long)).toBe('This is a long command that Samsung might inject a newline into\r')
    })

    it('preserves internal whitespace on each line', () => {
      expect(buildSendPayload('  spaces  \n  more  ')).toBe('  spaces  \r  more  \r')
      expect(buildSendPayload('tab\there\ntab\there')).toBe('tab\there\rtab\there\r')
    })

    it('handles a long multi-line paste', () => {
      const pasted = 'cd /tmp\nls -la\necho done'
      expect(buildSendPayload(pasted)).toBe('cd /tmp\rls -la\recho done\r')
    })
  })
})
