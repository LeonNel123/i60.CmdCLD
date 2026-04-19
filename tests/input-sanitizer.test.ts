import { describe, it, expect } from 'vitest'

// Load the remote-ui sanitizer. It's a browser IIFE that also exports via
// CommonJS when `module` is defined, which vitest sets up for us.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitize, hasNewline, buildSendPayload } = require('../src/remote-ui/input-sanitizer.js')

describe('remote input sanitizer', () => {
  describe('sanitize', () => {
    it('returns empty string for null/undefined', () => {
      expect(sanitize(null)).toBe('')
      expect(sanitize(undefined)).toBe('')
    })

    it('passes normal text through unchanged', () => {
      expect(sanitize('hello world')).toBe('hello world')
      expect(sanitize('npm run dev')).toBe('npm run dev')
    })

    it('strips single \\n (Samsung long-text injection)', () => {
      expect(sanitize('hello\n')).toBe('hello')
      expect(sanitize('hello\nworld')).toBe('helloworld')
    })

    it('strips single \\r', () => {
      expect(sanitize('hello\r')).toBe('hello')
    })

    it('strips mixed \\r\\n (Windows-style line endings)', () => {
      expect(sanitize('hello\r\nworld')).toBe('helloworld')
    })

    it('strips multiple consecutive newlines', () => {
      expect(sanitize('hello\n\n\nworld')).toBe('helloworld')
      expect(sanitize('hello\r\n\r\nworld')).toBe('helloworld')
    })

    it('handles only-newline input', () => {
      expect(sanitize('\n')).toBe('')
      expect(sanitize('\r\n')).toBe('')
      expect(sanitize('\n\r\n\r')).toBe('')
    })

    it('preserves internal whitespace that is not newlines', () => {
      expect(sanitize('  spaces  ')).toBe('  spaces  ')
      expect(sanitize('tab\there')).toBe('tab\there')
    })

    it('handles empty string', () => {
      expect(sanitize('')).toBe('')
    })

    it('handles long text with embedded newline (the bug case)', () => {
      const long = 'a'.repeat(200) + '\n'
      expect(sanitize(long)).toBe('a'.repeat(200))
    })
  })

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

    it('strips embedded newlines before appending \\r', () => {
      expect(buildSendPayload('hello\n')).toBe('hello\r')
      expect(buildSendPayload('hello\r\n')).toBe('hello\r')
      expect(buildSendPayload('hello\nworld')).toBe('helloworld\r')
    })

    it('handles the Samsung long-text case', () => {
      const long = 'This is a long command that Samsung might inject a newline into' + '\n'
      expect(buildSendPayload(long)).toBe('This is a long command that Samsung might inject a newline into\r')
    })

    it('preserves trailing \\r if the user somehow has one (gets replaced then re-added)', () => {
      expect(buildSendPayload('hello\r')).toBe('hello\r')
    })
  })
})
