// CmdCLD Remote — pure logic for the phone UI: list triage, the key row,
// fit-to-phone sizing and the session URL hash. Kept free of DOM and sockets
// so it can be unit-tested; attached to window.CmdCLD_Phone for app.js and
// terminal-view.js.
(function () {
  'use strict'

  // "4m", "2h", "3d" — how long a session has been working or idle. Seconds
  // are not shown: the list is refreshed a few times a minute, not every tick.
  function formatAge(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return ''
    var minutes = Math.floor(ms / 60000)
    if (minutes < 1) return '<1m'
    if (minutes < 60) return minutes + 'm'
    var hours = Math.floor(minutes / 60)
    if (hours < 24) return hours + 'h'
    return Math.floor(hours / 24) + 'd'
  }

  // The server sends an age rather than a timestamp, because its clock and
  // this device's can disagree. Convert once on receipt.
  function localSince(ageMs, now) {
    if (typeof ageMs !== 'number' || !isFinite(ageMs)) return null
    return now - ageMs
  }

  // Went idle after this device last had it open — the sessions worth a look.
  // activity: { busy, since } with `since` on this device's clock.
  function isUnseen(activity, seenAt) {
    if (!activity || activity.busy || activity.since == null) return false
    return activity.since > (seenAt || 0)
  }

  // Unseen finished sessions first, then working ones, then the rest. Within
  // the idle groups the most recently finished leads; name breaks every tie
  // so the order does not shuffle between renders.
  function sortForTriage(sessions, activityById, seenById) {
    activityById = activityById || {}
    seenById = seenById || {}
    function group(s) {
      var a = activityById[s.id]
      if (isUnseen(a, seenById[s.id])) return 0
      return a && a.busy ? 1 : 2
    }
    function since(s) {
      var a = activityById[s.id]
      return a && a.since != null ? a.since : null
    }
    return sessions.slice().sort(function (x, y) {
      var gx = group(x)
      var gy = group(y)
      if (gx !== gy) return gx - gy
      if (gx !== 1) {
        var sx = since(x)
        var sy = since(y)
        if (sx !== sy) {
          if (sx === null) return 1
          if (sy === null) return -1
          return sy - sx
        }
      }
      return String(x.name).localeCompare(String(y.name))
    })
  }

  var ARROWS = { up: 'A', down: 'B', right: 'C', left: 'D' }
  var KEYS = { esc: '\x1b', enter: '\r', tab: '\t', 'shift-tab': '\x1b[Z' }

  // Bytes for one key of the key row. `appCursor` is xterm's
  // modes.applicationCursorKeysMode: a program that set it expects SS3 arrows.
  function keySequence(key, appCursor) {
    if (Object.prototype.hasOwnProperty.call(ARROWS, key)) {
      return (appCursor ? '\x1bO' : '\x1b[') + ARROWS[key]
    }
    if (Object.prototype.hasOwnProperty.call(KEYS, key)) return KEYS[key]
    return null
  }

  var MIN_COLS = 20
  var MIN_ROWS = 6

  // PTY size for a phone that fits the terminal to its own screen.
  // `proposed` is what fits the output area now; `last` is what was applied
  // before. Rows only follow the height down when the width changed too —
  // otherwise the on-screen keyboard would shrink the PTY to a few rows and
  // make the agent repaint on every tap of the input.
  function fitDims(proposed, last) {
    if (!proposed || !isFinite(proposed.cols) || !isFinite(proposed.rows)) return null
    var cols = Math.max(MIN_COLS, Math.floor(proposed.cols))
    var rows = Math.max(MIN_ROWS, Math.floor(proposed.rows))
    if (last && last.cols === cols && rows < last.rows) rows = last.rows
    return { cols: cols, rows: rows }
  }

  // The open session lives in the URL hash so the phone's Back gesture returns
  // to the list and a reload reopens the same terminal.
  function sessionHash(id) {
    return '#s=' + id
  }

  function sessionFromHash(hash) {
    var m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash || '')
    return m ? m[1] : null
  }

  var api = {
    formatAge: formatAge,
    localSince: localSince,
    isUnseen: isUnseen,
    sortForTriage: sortForTriage,
    keySequence: keySequence,
    fitDims: fitDims,
    sessionHash: sessionHash,
    sessionFromHash: sessionFromHash,
  }

  if (typeof window !== 'undefined') window.CmdCLD_Phone = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
