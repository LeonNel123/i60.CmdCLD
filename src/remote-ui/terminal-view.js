// CmdCLD Remote — Terminal View (xterm.js for both desktop and mobile)
(function () {
  'use strict'

  var terminalContainer = document.getElementById('terminal-container')
  var mobileOutput = document.getElementById('mobile-output')
  var mobileInput = document.getElementById('mobile-input')
  var mobileSendBtn = document.getElementById('mobile-send-btn')
  var mobileImageInput = document.getElementById('mobile-image-input')
  var quickActions = document.getElementById('quick-actions')
  var fontDecBtn = document.getElementById('font-dec-btn')
  var fontIncBtn = document.getElementById('font-inc-btn')

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
    }
    return n
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
    return ok
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
    close()
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
    }

    if (scrollback) {
      term.write(scrollback)
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
        if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'c' || ev.key === 'C')) {
          if (term && term.hasSelection()) {
            copyText(term.getSelection())
            return false
          }
          return true
        }
        // Ctrl+Shift+C always copies, matching common terminal emulators.
        if (ev.type === 'keydown' && ev.ctrlKey && ev.shiftKey && (ev.key === 'C' || ev.key === 'c')) {
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
    var msg = '\r\n[Session exited with code ' + exitCode + ']'
    if (term) term.write(msg)
  }

  function close() {
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
    fetch('/api/sessions/' + currentId + '/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/png' },
      body: blob,
    }).catch(function () {})
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
  }

  mobileSendBtn.addEventListener('click', sendMobileInput)

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
  mobileInput.addEventListener('input', function (e) {
    if (e && e.inputType === 'insertFromPaste') return
    if (window.CmdCLD_InputSanitizer.hasNewline(mobileInput.value)) sendMobileInput()
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
  window.CmdCLD_Terminal = { open: open, close: close, onData: onData, onExit: onExit, onResize: onResize, copyOutput: copyOutput }
})()
