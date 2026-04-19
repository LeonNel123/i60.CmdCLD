// Pure send-payload logic for the mobile input bar.
// Extracted into its own file so it can be unit-tested and kept in sync.
// Attached to window.CmdCLD_InputSanitizer for use by terminal-view.js.
(function () {
  'use strict'

  // True if the raw value contains any newline character. Used by the
  // input-event fallback to decide whether the user "pressed Enter".
  function hasNewline(raw) {
    if (raw == null) return false
    return /[\r\n]/.test(String(raw))
  }

  // Build the terminal-bound payload from the input value.
  // - \r\n and \n are both converted to \r (terminal Enter) so multi-line
  //   pasted content executes each line in sequence instead of collapsing.
  // - Leading/trailing blank lines are stripped (nothing to execute there).
  // - Always appends a final \r so the last line submits.
  // - Returns null if the input is empty or only whitespace/newlines.
  function buildSendPayload(raw) {
    if (raw == null) return null
    var s = String(raw)
    // Normalise Windows line endings, then \n → \r.
    s = s.replace(/\r\n/g, '\r').replace(/\n/g, '\r')
    // Strip leading/trailing \r's (blank lines produce nothing).
    s = s.replace(/^\r+|\r+$/g, '')
    if (!s) return null
    return s + '\r'
  }

  var api = { hasNewline: hasNewline, buildSendPayload: buildSendPayload }

  // Expose for browser (terminal-view.js) and CommonJS (vitest).
  if (typeof window !== 'undefined') window.CmdCLD_InputSanitizer = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
