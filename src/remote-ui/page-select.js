// CmdCLD Remote — which page should this browser be on?
//
// `/` is the phone UI (one terminal at a time); `/desktop/` is the React
// renderer with the full grid. Chosen by viewport width at 769px (the same
// threshold terminal-view.js uses for isMobile), overridable with ?mobile or
// ?desktop, and the override is remembered per browser.
(function () {
  'use strict'

  var STORAGE_KEY = 'cmdcld-remote-page'
  var DESKTOP_MIN_WIDTH = 769

  function flagIn(search, name) {
    return new RegExp('[?&]' + name + '(=|&|$)').test(search || '')
  }

  // page: 'mobile' | 'desktop' — which page is running this.
  // Returns { go: null | '/' | '/desktop/', remember: null | 'mobile' | 'desktop' }.
  function choosePage(args) {
    var want
    var remember = null
    if (flagIn(args.search, 'mobile')) { want = 'mobile'; remember = 'mobile' }
    else if (flagIn(args.search, 'desktop')) { want = 'desktop'; remember = 'desktop' }
    else if (args.stored === 'mobile' || args.stored === 'desktop') want = args.stored
    else want = args.width >= DESKTOP_MIN_WIDTH ? 'desktop' : 'mobile'

    var go = null
    // An explicit flag rides along, so the override still holds on the other
    // page when localStorage is unavailable (private mode) to remember it.
    if (want !== args.page) go = want === 'desktop' ? '/desktop/' + (remember ? '?desktop' : '') : '/' + (remember ? '?mobile' : '')
    return { go: go, remember: remember }
  }

  // The width that decides phone vs desktop. On a touch-first device it is the
  // screen's short side, so a phone held in landscape (852-932px wide) still
  // counts as a phone and does not get stuck on /desktop/ after rotating back.
  // Everything else uses the window width as before — a 1366x768 laptop has a
  // short side of 768 and must not be sent to the phone page.
  function deviceWidth(win) {
    var coarse = false
    try { coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches) } catch (e) {}
    var s = win.screen
    if (coarse && s && s.width > 0 && s.height > 0) return Math.min(s.width, s.height)
    return win.innerWidth
  }

  // Runs the rule for the current document and redirects if needed.
  function apply(page) {
    var stored = null
    try { stored = localStorage.getItem(STORAGE_KEY) } catch (e) {}
    var r = choosePage({ page: page, width: deviceWidth(window), search: location.search, stored: stored })
    if (r.remember) { try { localStorage.setItem(STORAGE_KEY, r.remember) } catch (e) {} }
    if (r.go) location.replace(r.go)
    return r
  }

  var api = { choosePage: choosePage, apply: apply, deviceWidth: deviceWidth, STORAGE_KEY: STORAGE_KEY, DESKTOP_MIN_WIDTH: DESKTOP_MIN_WIDTH }
  if (typeof window !== 'undefined') window.CmdCLD_PageSelect = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
