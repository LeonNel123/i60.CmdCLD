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

  // Build the text of a composed message (input bar, quick actions).
  //
  // Internal newlines are PRESERVED as \n. The server wraps the body in bracketed
  // paste and appends a single Enter, so a multi-paragraph prompt arrives as one
  // message. The old buildSendPayload converted every newline to \r, which made each
  // line submit separately and split one prompt into several messages.
  //
  // No trailing \r here — the server owns the submit so it can delay it.
  // Returns null when there is nothing to send.
  function buildSubmitText(raw) {
    if (raw == null) return null
    var s = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    s = s.replace(/^[\s]+|[\s]+$/g, '')
    return s ? s : null
  }

  var api = { hasNewline: hasNewline, buildSubmitText: buildSubmitText }

  // Expose for browser (terminal-view.js) and CommonJS (vitest).
  if (typeof window !== 'undefined') window.CmdCLD_InputSanitizer = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
