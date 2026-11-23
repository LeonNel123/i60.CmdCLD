// CmdCLD Remote — Terminal View (xterm.js for both desktop and mobile)
(function () {
  'use strict'

  var terminalContainer = document.getElementById('terminal-container')
  var mobileOutput = document.getElementById('mobile-output')
  var mobileInput = document.getElementById('mobile-input')
  var mobileClearBtn = document.getElementById('mobile-clear-btn')
  var mobileSendBtn = document.getElementById('mobile-send-btn')
  var mobileImageInput = document.getElementById('mobile-image-input')
  var quickActions = document.getElementById('quick-actions')
  var fontDecBtn = document.getElementById('font-dec-btn')
  var fontIncBtn = document.getElementById('font-inc-btn')
  var fitBtn = document.getElementById('fit-btn')

  var term = null
  var fitAddon = null
  var currentId = null
  var currentSocket = null
  var remoteResizeHandler = null
  // Track the resize-fit pair across open()/close() so they can be torn down.
  // Without this, each open() leaked a window-resize listener and a
  // ResizeObserver per session switch.
  var safeFitHandler = null
  var resizeObs = null

  function isMobile() {
    return window.innerWidth <= 768
  }

  // Mobile font-size control — persists across sessions
  var MOBILE_FONT_KEY = 'cmdcld-remote-mobile-font-size'
  var MOBILE_FONT_MIN = 8
  var MOBILE_FONT_MAX = 24
  var MOBILE_FONT_DEFAULT = 12

  function getMobileFontSize() {
    try {
      var v = parseInt(localStorage.getItem(MOBILE_FONT_KEY), 10)
      if (!isNaN(v) && v >= MOBILE_FONT_MIN && v <= MOBILE_FONT_MAX) return v
    } catch (e) {}
    return MOBILE_FONT_DEFAULT
  }

  function setMobileFontSize(n) {
    n = Math.max(MOBILE_FONT_MIN, Math.min(MOBILE_FONT_MAX, n))
    try { localStorage.setItem(MOBILE_FONT_KEY, String(n)) } catch (e) {}
    if (term && isMobile()) {
      try { term.options.fontSize = n } catch (e) {}
      fitToPhone() // a different cell size fits a different number of columns
    }
    return n
  }

  // Fit to phone — size the PTY to this screen instead of mirroring the PC's.
  //
  // By default the phone shows the terminal at whatever size the PC window
  // gave it, so lines run off the side and you pan. With Fit on, the agent
  // re-wraps to the phone's width. The cost: the PC window's tile shows the
  // narrow layout until the phone leaves the terminal, which is why this is a
  // toggle (remembered) and not the default.
  var FIT_KEY = 'cmdcld-remote-fit'
  var fitOn = false
  try { fitOn = localStorage.getItem(FIT_KEY) === '1' } catch (e) {}
  // Whether we told the server this phone owns PTY size (see size:claim in
  // remote-server.ts). The server forgets on disconnect, so claiming is
  // always re-sent rather than trusted from this flag.
  var sizeClaimed = false
  // Last size applied by fitToPhone; kept across sessions, it is a property
  // of this screen.
  var lastFit = null

  // The size belongs to the device being used. When the PC (or another
  // device) is used it takes the size and the server says so: from then this
  // terminal mirrors the PTY, and fitting waits until the phone is touched.
  var sizeLost = false

  function claimSize() {
    if (!currentSocket) return
    sizeClaimed = true
    sizeLost = false
    currentSocket.emit('size:claim', { on: true })
  }

  function releaseSize() {
    if (!sizeClaimed) return
    sizeClaimed = false
    sizeLost = false
    if (currentSocket) currentSocket.emit('size:claim', { on: false })
  }

  // `size:owner {you}` from the server, for every change of owner.
  function onSizeOwner(mine) {
    if (!sizeClaimed) return
    if (!mine) { sizeLost = true; return }
    if (sizeLost) { sizeLost = false; fitToPhone() }
  }

  // Touching the terminal screen again is using the phone: take the size
  // back and fit. Leaving the terminal is not.
  function reclaimSize(e) {
    if (!sizeLost || !fitOn || !term || !isMobile()) return
    var target = e && e.target
    if (target && target.closest && target.closest('#back-btn')) return
    claimSize()
    fitToPhone()
  }

  // xterm measures its cell from whatever font is available when it opens. On
  // a first visit that is the fallback, JetBrains Mono arriving a moment
  // later; the cell is then wider and taller than xterm believes and a fit
  // overshoots the screen. Wait for the font, make xterm measure again (it
  // only does so when a font option changes or the grid resizes), then fit.
  var fontsReady = !(document.fonts && document.fonts.load)
  if (!fontsReady) {
    var onFonts = function () {
      if (fontsReady) return
      fontsReady = true
      remeasureCell()
      fitToPhone()
    }
    Promise.all([
      document.fonts.load("12px 'JetBrains Mono'"),
      document.fonts.load("bold 12px 'JetBrains Mono'"),
    ]).then(onFonts, onFonts)
    setTimeout(onFonts, 3000) // a font that never arrives must not block fitting
  }

  function remeasureCell() {
    if (!term) return
    try {
      var size = term.options.fontSize
      term.options.fontSize = size + 1
      term.options.fontSize = size
    } catch (e) {}
  }

  function fitToPhone() {
    if (!fitOn || sizeLost || !fontsReady || !term || !fitAddon || !currentSocket || !currentId || !isMobile()) return
    if (mobileOutput.clientWidth <= 0 || mobileOutput.clientHeight <= 0) return
    var proposed
    try { proposed = fitAddon.proposeDimensions() } catch (e) { return }
    var dims = window.CmdCLD_Phone.fitDims(proposed, lastFit)
    if (!dims) return
    lastFit = dims
    if (term.cols !== dims.cols || term.rows !== dims.rows) {
      try { term.resize(dims.cols, dims.rows) } catch (e) {}
    }
    if (ptyCols !== dims.cols || ptyRows !== dims.rows) {
      ptyCols = dims.cols
      ptyRows = dims.rows
      currentSocket.emit('session:resize', { id: currentId, cols: dims.cols, rows: dims.rows })
    }
    // Rows are kept when the keyboard opens, so the terminal is now taller
    // than its box: keep the bottom — the prompt — in view.
    mobileOutput.scrollTop = mobileOutput.scrollHeight
  }

  function renderFitBtn() {
    if (fitBtn) fitBtn.setAttribute('aria-pressed', fitOn ? 'true' : 'false')
  }

  // Clipboard write that also works over plain http.
  //
  // The remote server is http, and Tailscale addresses are not localhost, so the page
  // is NOT a secure context and navigator.clipboard is unavailable there. The hidden
  // textarea + execCommand('copy') path is the only one that works on that setup, so
  // it is a required fallback, not a legacy nicety.
  function copyText(text) {
    if (!text) return false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(function () { legacyCopy(text) })
        return true
      }
    } catch (e) {}
    return legacyCopy(text)
  }

  function legacyCopy(text) {
    // select() moves focus to the temporary textarea; without handing it back
    // the terminal stops receiving keystrokes after every copy.
    var previous = document.activeElement
    var ta = document.createElement('textarea')
    ta.value = text
    // Keep it off-screen but selectable; display:none would break execCommand.
    ta.setAttribute('readonly', 'readonly')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    var ok = false
    try {
      ta.select()
      ta.setSelectionRange(0, ta.value.length)
      ok = document.execCommand('copy')
    } catch (e) {}
    document.body.removeChild(ta)
    try { if (previous && previous.focus) previous.focus({ preventScroll: true }) } catch (e) {}
    return ok
  }

  // Ready xterm's hidden textarea for the browser's native copy (see the
  // Ctrl/Cmd+C handler): select the text in it so the copy carries it, and
  // keep focus where it is so typing carries on. Cleared once the copy ran.
  function primeNativeCopy(text) {
    var ta = term && term.textarea
    if (!ta || !text) return
    ta.value = text
    ta.select()
    setTimeout(function () { ta.value = '' }, 0)
  }

  // Whole scrollback, trailing blank lines trimmed. term.buffer.active covers
  // scrollback and viewport together.
  function bufferText() {
    if (!term) return ''
    var buf = term.buffer.active
    var out = []
    for (var i = 0; i < buf.length; i++) {
      var line = buf.getLine(i)
      out.push(line ? line.translateToString(true) : '')
    }
    while (out.length && !out[out.length - 1]) out.pop()
    return out.join('\n')
  }

  // Selection if there is one, otherwise the whole buffer.
  function copyOutput() {
    if (!term) return false
    var text = term.hasSelection() ? term.getSelection() : bufferText()
    return copyText(text)
  }

  var ptyCols = 80
  var ptyRows = 24

  function open(id, scrollback, socket, cols, rows) {
    // Not close(): that hands PTY size back to the PC, and when Fit is on we
    // are about to claim it again — two resizes for every session switch.
    teardown()
    currentId = id
    currentSocket = socket
    if (cols) ptyCols = cols
    if (rows) ptyRows = rows

    var mobile = isMobile()
    var container = mobile ? mobileOutput : terminalContainer

    term = new Terminal({
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      fontSize: mobile ? getMobileFontSize() : 14,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace",
      cursorBlink: !mobile,
      cursorStyle: 'bar',
      scrollback: 5000,
      cols: ptyCols,
      rows: ptyRows,
      disableStdin: mobile, // mobile uses the input bar, not xterm's textarea
    })

    fitAddon = new FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    // Size xterm to the container and claim the PTY size. The server
    // relays session:resize to all other clients so their xterm instances
    // update cols/rows to match — keeps wrapping coherent across clients.
    if (!mobile) {
      // Tracks the dims most recently applied by a remote-driven resize, so
      // our own post-fit resize doesn't echo them back.
      var lastRemoteDims = null
      var safeFit = function () {
        try {
          if (!fitAddon || !term || !term.element) return
          if (container.clientWidth <= 0 || container.clientHeight <= 0) return
          fitAddon.fit()
          var cols = term.cols
          var rows = term.rows
          if (!lastRemoteDims || lastRemoteDims.cols !== cols || lastRemoteDims.rows !== rows) {
            if (currentSocket && currentId) {
              currentSocket.emit('session:resize', { id: currentId, cols: cols, rows: rows })
            }
          }
        } catch (e) {}
      }

      // The remote-driven resize handler needs to see this session's
      // `lastRemoteDims`, so rebind it on every open() call.
      remoteResizeHandler = function (cols, rows) {
        if (!term) return
        lastRemoteDims = { cols: cols, rows: rows }
        if (term.cols !== cols || term.rows !== rows) {
          try { term.resize(cols, rows) } catch (e) {}
        }
      }

      // First fit as soon as layout is ready, then retry across the next few
      // frames in case the container was still transitioning out of `.hidden`
      // when term.open() was called.
      requestAnimationFrame(function () {
        safeFit()
        requestAnimationFrame(safeFit)
        setTimeout(safeFit, 50)
        setTimeout(safeFit, 150)
        setTimeout(safeFit, 400)
      })

      if (window.ResizeObserver) {
        var resizeTimer = null
        resizeObs = new ResizeObserver(function () {
          if (resizeTimer) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(safeFit, 60)
        })
        resizeObs.observe(container)
      }

      safeFitHandler = safeFit
      window.addEventListener('resize', safeFitHandler)
    } else {
      // Unless Fit is on the phone never claims a size, but it must follow the
      // PTY when another client resizes it — or every line wraps at the old
      // width.
      remoteResizeHandler = function (cols, rows) {
        if (!term) return
        ptyCols = cols
        ptyRows = rows
        if (term.cols !== cols || term.rows !== rows) {
          try { term.resize(cols, rows) } catch (e) {}
        }
      }

      // Fit on: follow the output area (rotation, keyboard, browser bars).
      if (window.ResizeObserver) {
        var fitTimer = null
        resizeObs = new ResizeObserver(function () {
          if (fitTimer) clearTimeout(fitTimer)
          fitTimer = setTimeout(fitToPhone, 120)
        })
        resizeObs.observe(container)
      }
    }

    // Scrollback was produced at the PTY's current width; write it at that
    // width and only then fit, so xterm reflows it instead of mangling it.
    var afterScrollback = function () {
      if (!mobile || !term || currentId !== id) return
      if (fitOn) { claimSize(); fitToPhone() }
      else releaseSize()
    }
    if (scrollback) {
      term.write(scrollback, afterScrollback)
    } else {
      afterScrollback()
    }

    if (!mobile) {
      // Desktop: forward xterm keystrokes to the PTY
      term.onData(function (data) {
        if (currentSocket && currentId) {
          currentSocket.emit('session:input', { id: currentId, data: data })
        }
      })

      // Desktop: let Ctrl+V (and Cmd+V on Mac) fall through to the browser's
      // native paste flow instead of being captured by xterm as a ^V keystroke.
      // Without this, dictation tools and Ctrl+V are silently dropped because
      // xterm calls preventDefault on keydown before the browser can fire a
      // paste event on the textarea. Right-click → Paste already works because
      // it bypasses keydown entirely.
      term.attachCustomKeyEventHandler(function (ev) {
        if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'v' || ev.key === 'V')) {
          return false
        }
        // Ctrl/Cmd+C with an active selection copies. Without a selection it must
        // still reach the PTY as  — that is the interrupt, and stealing it would
        // leave no way to stop a running agent from the keyboard.
        if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key === 'c' || ev.key === 'C')) {
          // With a selection, let the browser's own copy run: it works over plain
          // http and, unlike the hidden-textarea fallback, never moves focus.
          if (term && term.hasSelection()) {
            primeNativeCopy(term.getSelection())
            return false
          }
          return true
        }
        // Ctrl+Shift+C (Cmd+Shift+C on a Mac) always copies, matching common
        // terminal emulators.
        if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === 'C' || ev.key === 'c')) {
          ev.preventDefault() // Chrome's element inspector is also Ctrl/Cmd+Shift+C
          copyOutput()
          return false
        }
        return true
      })

      // Desktop: intercept image-only paste (let xterm handle text paste natively).
      // Many clipboards carry both text and image formats simultaneously
      // (copying from VS Code, browsers, Office). Prefer text — only upload
      // the image when there is no usable text alongside it.
      term.textarea.addEventListener('paste', function (ev) {
        var items = (ev.clipboardData || {}).items || []
        var hasText = false
        var imageFile = null
        for (var i = 0; i < items.length; i++) {
          var it = items[i]
          if (it.kind === 'string' && it.type.indexOf('text/') === 0) {
            hasText = true
          } else if (it.kind === 'file' && it.type.indexOf('image/') === 0 && !imageFile) {
            imageFile = it.getAsFile()
          }
        }
        if (imageFile && !hasText) {
          ev.preventDefault()
          uploadImage(imageFile)
        }
      })
    } else {
      // Mobile: stop xterm's hidden textarea from triggering the virtual keyboard.
      // The user types into #mobile-input; the terminal is read-only for them.
      if (term.textarea) {
        term.textarea.setAttribute('readonly', 'readonly')
        term.textarea.setAttribute('inputmode', 'none')
        term.textarea.setAttribute('tabindex', '-1')
        term.textarea.setAttribute('aria-hidden', 'true')
      }
      // Do NOT auto-focus the input bar — that pops the mobile keyboard on
      // open. The user taps #mobile-input when they are ready to type.
    }
  }

  function onData(data) {
    if (term) term.write(data)
  }

  function onExit(exitCode) {
    var msg = exitCode == null ? '\r\n[Session closed]' : '\r\n[Session exited with code ' + exitCode + ']'
    if (term) term.write(msg)
  }

  // Leaving the terminal: the PC window gets PTY size back.
  function close() {
    releaseSize()
    teardown()
  }

  function teardown() {
    if (safeFitHandler) {
      window.removeEventListener('resize', safeFitHandler)
      safeFitHandler = null
    }
    if (resizeObs) {
      try { resizeObs.disconnect() } catch (e) {}
      resizeObs = null
    }
    if (term) {
      term.dispose()
      term = null
      fitAddon = null
    }
    terminalContainer.innerHTML = ''
    mobileOutput.innerHTML = ''
    currentId = null
    currentSocket = null
    remoteResizeHandler = null
  }

  function onResize(cols, rows) {
    if (remoteResizeHandler) remoteResizeHandler(cols, rows)
  }

  function uploadImage(blob) {
    if (!currentId) return
    // Failures are shown in this view only (term.write never reaches the PTY).
    function fail(msg) { if (term) term.write('\r\n\x1b[31m[Image upload failed: ' + msg + ']\x1b[0m\r\n') }
    fetch('/api/sessions/' + currentId + '/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/png' },
      body: blob,
    }).then(function (r) {
      if (r.ok) return
      return r.json().then(function (b) { fail((b && b.error) || ('HTTP ' + r.status)) }, function () { fail('HTTP ' + r.status) })
    }).catch(function () { fail('connection lost') })
  }

  // Single source of truth for sending. Every trigger — Send tap, Enter key,
  // input-event fallback — funnels here.
  //
  // Emits session:submit, NOT session:input. The server routes submits through the
  // queued writer so the Enter is delayed behind the text; sending both in one write
  // lets the agent CLI drop the submit and leaves the prompt sitting unsent.
  function sendMobileInput() {
    if (!currentSocket || !currentId) return
    var text = window.CmdCLD_InputSanitizer.buildSubmitText(mobileInput.value)
    if (text === null) return
    currentSocket.emit('session:submit', { id: currentId, text: text })
    mobileInput.value = ''
    composerNewlines = 0
    fitMobileInput()
  }

  // Size the composer to its content: two lines minimum, a viewport-relative cap
  // (matching the CSS max-height) above which it scrolls. Height is reset to auto
  // first so scrollHeight reflects the current text rather than the last fit.
  // Also toggles the clear button, which only earns its space when there is text.
  function fitMobileInput() {
    var cs = window.getComputedStyle(mobileInput)
    var minPx = parseFloat(cs.minHeight) || 0
    var maxPx = parseFloat(cs.maxHeight) || Infinity
    mobileInput.style.height = 'auto'
    var h = window.CmdCLD_InputSanitizer.fitInputHeight(mobileInput.scrollHeight, minPx, maxPx)
    mobileInput.style.height = h + 'px'
    mobileClearBtn.hidden = !mobileInput.value
  }

  mobileSendBtn.addEventListener('click', sendMobileInput)

  mobileClearBtn.addEventListener('click', function () {
    mobileInput.value = ''
    composerNewlines = 0
    fitMobileInput()
    mobileInput.focus()
  })

  mobileInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      sendMobileInput()
    }
  })

  // Some mobile keyboards (Gboard, Samsung) skip keydown for Enter and fire
  // a beforeinput with inputType "insertLineBreak" instead.
  mobileInput.addEventListener('beforeinput', function (e) {
    if (e.inputType === 'insertLineBreak') {
      e.preventDefault()
      sendMobileInput()
    }
  })

  // Last-resort fallback: Samsung keyboards on long text sometimes bypass
  // both keydown and beforeinput and just inject a raw \n into the value.
  // Skip paste events — pasted multi-line content is intentional and the
  // user may want to review it before hitting Send.
  // Only a newline this event ADDED counts as Enter — newlines left in the box
  // by an earlier paste must not send the prompt on the next keystroke.
  var composerNewlines = 0
  mobileInput.addEventListener('input', function (e) {
    fitMobileInput()
    var n = window.CmdCLD_InputSanitizer.countNewlines(mobileInput.value)
    var added = n > composerNewlines
    composerNewlines = n
    if (e && e.inputType === 'insertFromPaste') return
    if (added) sendMobileInput()
  })

  // Quick action buttons
  var quickBtns = quickActions.querySelectorAll('.quick-btn')
  for (var i = 0; i < quickBtns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (!currentSocket || !currentId) return
        // data-input values end in &#13;, which buildSubmitText strips — the server
        // appends the Enter itself once the body has landed.
        var text = window.CmdCLD_InputSanitizer.buildSubmitText(btn.dataset.input)
        if (text === null) return
        currentSocket.emit('session:submit', { id: currentId, text: text })
      })
    })(quickBtns[i])
  }

  // Key row: Esc, arrows, Tab, Enter as raw input for agent menus.
  var keyBtns = document.querySelectorAll('.key-btn')
  for (var k = 0; k < keyBtns.length; k++) {
    (function (btn) {
      // Keep focus where it is: with the composer focused, a tap that moved
      // focus would drop the on-screen keyboard between arrow presses.
      btn.addEventListener('mousedown', function (e) { e.preventDefault() })
      btn.addEventListener('click', function () {
        if (!currentSocket || !currentId) return
        var appCursor = !!(term && term.modes && term.modes.applicationCursorKeysMode)
        var seq = window.CmdCLD_Phone.keySequence(btn.dataset.key, appCursor)
        if (seq === null) return
        currentSocket.emit('session:input', { id: currentId, data: seq })
      })
    })(keyBtns[k])
  }

  if (fitBtn) {
    fitBtn.addEventListener('click', function () {
      fitOn = !fitOn
      try { localStorage.setItem(FIT_KEY, fitOn ? '1' : '0') } catch (e) {}
      renderFitBtn()
      if (!term || !isMobile()) return
      if (fitOn) { claimSize(); fitToPhone() }
      // Off: the PC window refits its tile and this terminal follows it.
      else releaseSize()
    })
  }
  renderFitBtn()

  var terminalScreen = document.getElementById('terminal-view')
  if (terminalScreen) terminalScreen.addEventListener('pointerdown', reclaimSize, true)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') reclaimSize()
  })

  // Mobile image upload
  mobileImageInput.addEventListener('change', function (e) {
    var file = e.target.files[0]
    if (!file) return
    uploadImage(file)
    mobileImageInput.value = ''
  })

  // Mobile font-size controls
  if (fontDecBtn) {
    fontDecBtn.addEventListener('click', function () {
      setMobileFontSize(getMobileFontSize() - 1)
    })
  }
  if (fontIncBtn) {
    fontIncBtn.addEventListener('click', function () {
      setMobileFontSize(getMobileFontSize() + 1)
    })
  }

  // Help modal
  var helpBtn = document.getElementById('help-btn')
  var helpModal = document.getElementById('help-modal')
  var closeHelpBtn = document.getElementById('close-help')
  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', function () {
      helpModal.classList.remove('hidden')
    })
  }
  if (closeHelpBtn && helpModal) {
    closeHelpBtn.addEventListener('click', function () {
      helpModal.classList.add('hidden')
    })
  }
  if (helpModal) {
    var backdrop = helpModal.querySelector('.modal-backdrop')
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        helpModal.classList.add('hidden')
      })
    }
  }

  // Handle mobile virtual keyboard — resize terminal view to visible area
  if (window.visualViewport) {
    function adjustForKeyboard() {
      var termView = document.getElementById('terminal-view')
      if (termView && !termView.classList.contains('hidden')) {
        termView.style.height = window.visualViewport.height + 'px'
      }
    }
    window.visualViewport.addEventListener('resize', adjustForKeyboard)
    window.visualViewport.addEventListener('scroll', adjustForKeyboard)
  }

  // Expose globally
  window.CmdCLD_Terminal = { open: open, close: close, onData: onData, onExit: onExit, onResize: onResize, onSizeOwner: onSizeOwner, copyOutput: copyOutput, copyText: copyText, bufferText: bufferText, hasSelection: function () { return !!(term && term.hasSelection()) }, isMobile: isMobile }
})()
