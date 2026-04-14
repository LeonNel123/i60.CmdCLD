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
      fontFamily: "'Cascadia Code', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace",
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
        var resizeObs = new ResizeObserver(function () {
          if (resizeTimer) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(safeFit, 60)
        })
        resizeObs.observe(container)
      }

      window.addEventListener('resize', safeFit)
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

      // Desktop: intercept image paste (let xterm handle text paste natively)
      term.textarea.addEventListener('paste', function (ev) {
        var items = (ev.clipboardData || {}).items || []
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image/') === 0) {
            ev.preventDefault()
            uploadImage(items[i].getAsFile())
            return
          }
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

  // Mobile input handling
  mobileSendBtn.addEventListener('click', function () {
    var text = mobileInput.value
    if (text && currentSocket && currentId) {
      currentSocket.emit('session:input', { id: currentId, data: text + '\r' })
      mobileInput.value = ''
    }
  })

  mobileInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      mobileSendBtn.click()
    }
  })

  // Some mobile keyboards (Gboard, Samsung) skip keydown for Enter and fire
  // a beforeinput with inputType "insertLineBreak" instead. Catch that too.
  mobileInput.addEventListener('beforeinput', function (e) {
    if (e.inputType === 'insertLineBreak') {
      e.preventDefault()
      mobileSendBtn.click()
    }
  })

  // Quick action buttons
  var quickBtns = quickActions.querySelectorAll('.quick-btn')
  for (var i = 0; i < quickBtns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var input = btn.dataset.input
        if (input && currentSocket && currentId) {
          currentSocket.emit('session:input', { id: currentId, data: input })
        }
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
  window.CmdCLD_Terminal = { open: open, close: close, onData: onData, onExit: onExit, onResize: onResize }
})()
