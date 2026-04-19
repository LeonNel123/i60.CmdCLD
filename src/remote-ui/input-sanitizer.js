// Pure sanitization logic for the mobile input bar.
// Extracted into its own file so it can be unit-tested and kept in sync.
// Attached to window.CmdCLD_InputSanitizer for use by terminal-view.js.
(function () {
  'use strict'

  // Strip embedded \r and \n from typed/pasted text. Mobile keyboards
  // (notably Samsung on long text) can inject raw newlines when the user
  // presses Enter, bypassing keydown/beforeinput. We always clean the
  // value before sending to the terminal.
  function sanitize(raw) {
    if (raw == null) return ''
    return String(raw).replace(/[\r\n]+/g, '')
  }

  // True if the raw value contains any newline character. Used by the
  // input-event fallback to decide whether the user "pressed Enter".
  function hasNewline(raw) {
    if (raw == null) return false
    return /[\r\n]/.test(String(raw))
  }

  // Full send-path decision: returns the payload to emit, or null to skip.
  // Terminal Enter is \r, so we append that to sanitised text.
  function buildSendPayload(raw) {
    var clean = sanitize(raw)
    if (!clean) return null
    return clean + '\r'
  }

  var api = { sanitize: sanitize, hasNewline: hasNewline, buildSendPayload: buildSendPayload }

  // Expose for browser (terminal-view.js) and CommonJS (vitest).
  if (typeof window !== 'undefined') window.CmdCLD_InputSanitizer = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
