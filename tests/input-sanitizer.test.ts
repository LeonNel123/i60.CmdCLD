import { describe, it, expect } from 'vitest'

// Load the remote-ui sanitizer. It's a browser IIFE that also exports via
// CommonJS when `module` is defined, which vitest sets up for us.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hasNewline, countNewlines, buildSubmitText } = require('../src/remote-ui/input-sanitizer.js')

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

  // buildSubmitText replaced buildSendPayload. The old builder appended \r and
  // converted every internal newline to \r as well, so a multi-paragraph prompt
  // submitted line by line and arrived as several separate messages. The server now
  // owns the submit (delayed, after the body) and bracketed-paste wrapping.
  describe('buildSubmitText', () => {
    it('returns null when there is nothing to send', () => {
      expect(buildSubmitText('')).toBeNull()
      expect(buildSubmitText(null)).toBeNull()
      expect(buildSubmitText(undefined)).toBeNull()
      expect(buildSubmitText('   ')).toBeNull()
    })

    it('returns null when input is only newlines', () => {
      expect(buildSubmitText('\n')).toBeNull()
      expect(buildSubmitText('\r\n')).toBeNull()
      expect(buildSubmitText('\n\n\n')).toBeNull()
    })

    it('never appends a submit character — the server owns that', () => {
      expect(buildSubmitText('hello')).toBe('hello')
      expect(buildSubmitText('npm run dev')).toBe('npm run dev')
    })

    it('strips the trailing Enter that quick-action buttons carry', () => {
      // data-input values end in &#13;, i.e. a literal carriage return.
      expect(buildSubmitText('yes\r')).toBe('yes')
      expect(buildSubmitText('You decide — proceed.\r')).toBe('You decide — proceed.')
    })

    it('keeps a multi-paragraph prompt as ONE message', () => {
      // The whole point: internal newlines stay \n so bracketed paste delivers this
      // as a single message instead of three.
      expect(buildSubmitText('para one\n\npara two')).toBe('para one\n\npara two')
      expect(buildSubmitText('line1\nline2\nline3')).toBe('line1\nline2\nline3')
    })

    it('normalises Windows line endings to \\n', () => {
      expect(buildSubmitText('line1\r\nline2')).toBe('line1\nline2')
    })

    it('normalises a lone \\r inside the body to \\n', () => {
      expect(buildSubmitText('line1\rline2')).toBe('line1\nline2')
    })

    it('handles the Samsung trailing-newline case', () => {
      expect(buildSubmitText('a long dictated sentence\n')).toBe('a long dictated sentence')
    })

    it('strips surrounding blank lines but keeps interior structure', () => {
      expect(buildSubmitText('\n\nhello\n\n')).toBe('hello')
      expect(buildSubmitText('\n a \n b \n')).toBe('a \n b')
    })
  })
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fitInputHeight } = require('../src/remote-ui/input-sanitizer.js')

describe('fitInputHeight', () => {
  // The composer grows with its content so every word stays visible and tappable,
  // but never past the cap — beyond that it scrolls instead of eating the terminal.
  it('never shrinks below the two-line minimum', () => {
    expect(fitInputHeight(10, 48, 200)).toBe(48)
    expect(fitInputHeight(0, 48, 200)).toBe(48)
  })

  it('follows the content height between the bounds', () => {
    expect(fitInputHeight(72, 48, 200)).toBe(72)
  })

  it('caps at the maximum so a long prompt scrolls instead of growing', () => {
    expect(fitInputHeight(900, 48, 200)).toBe(200)
  })

  it('treats a non-finite content height as the minimum', () => {
    expect(fitInputHeight(NaN, 48, 200)).toBe(48)
    expect(fitInputHeight(undefined, 48, 200)).toBe(48)
  })
})

describe('countNewlines — the composer fallback fires only when one is added', () => {
  it('counts \\n, \\r and \\r\\n as one each', () => {
    expect(countNewlines(null)).toBe(0)
    expect(countNewlines('one line')).toBe(0)
    expect(countNewlines('a\nb\r\nc\rd')).toBe(3)
  })
  it('a keystroke after a multi-line paste adds none', () => {
    const pasted = 'line one\nline two'
    expect(countNewlines(pasted + 'x')).toBe(countNewlines(pasted))
  })
})
