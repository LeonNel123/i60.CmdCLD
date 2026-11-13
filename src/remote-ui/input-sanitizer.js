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

  // Newline count, for the input-event fallback: it must fire only when a
  // newline was just ADDED. A multi-line paste leaves newlines in the box, and
  // testing the whole value would send the half-written prompt on the next
  // ordinary keystroke.
  function countNewlines(raw) {
    if (raw == null) return 0
    var m = String(raw).replace(/\r\n/g, '\n').match(/[\r\n]/g)
    return m ? m.length : 0
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

  // Height for the auto-growing composer: follow the content between a two-line
  // floor and a viewport-relative cap. Past the cap the textarea scrolls instead
  // of eating the terminal. Non-finite input (no layout yet) means the floor.
  function fitInputHeight(scrollHeight, minPx, maxPx) {
    var h = Number(scrollHeight)
    if (!isFinite(h)) return minPx
    return Math.min(Math.max(h, minPx), maxPx)
  }

  var api = { hasNewline: hasNewline, countNewlines: countNewlines, buildSubmitText: buildSubmitText, fitInputHeight: fitInputHeight }

  // Expose for browser (terminal-view.js) and CommonJS (vitest).
  if (typeof window !== 'undefined') window.CmdCLD_InputSanitizer = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
