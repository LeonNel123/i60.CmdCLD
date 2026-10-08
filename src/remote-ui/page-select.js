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
    if (want !== args.page) go = want === 'desktop' ? '/desktop/' : '/'
    return { go: go, remember: remember }
  }

  // Runs the rule for the current document and redirects if needed.
  function apply(page) {
    var stored = null
    try { stored = localStorage.getItem(STORAGE_KEY) } catch (e) {}
    var r = choosePage({ page: page, width: window.innerWidth, search: location.search, stored: stored })
    if (r.remember) { try { localStorage.setItem(STORAGE_KEY, r.remember) } catch (e) {} }
    if (r.go) location.replace(r.go)
    return r
  }

  var api = { choosePage: choosePage, apply: apply, STORAGE_KEY: STORAGE_KEY, DESKTOP_MIN_WIDTH: DESKTOP_MIN_WIDTH }
  if (typeof window !== 'undefined') window.CmdCLD_PageSelect = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
