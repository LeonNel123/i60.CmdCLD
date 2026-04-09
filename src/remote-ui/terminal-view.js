// CmdCLD Remote — Terminal View (xterm.js desktop + mobile fallback)
(function () {
  'use strict'

  var terminalContainer = document.getElementById('terminal-container')
  var mobileOutput = document.getElementById('mobile-output')
  var mobileInput = document.getElementById('mobile-input')
  var mobileSendBtn = document.getElementById('mobile-send-btn')
  var mobileImageInput = document.getElementById('mobile-image-input')
  var quickActions = document.getElementById('quick-actions')

  var term = null
  var fitAddon = null
  var currentId = null
  var currentSocket = null
  var resizeObserver = null
  var mobileBuffer = ''
  var MAX_MOBILE_BUFFER = 15000

  function isMobile() {
    return window.innerWidth <= 768
  }

  var ptyCols = 80
  var ptyRows = 24

  function open(id, scrollback, socket, cols, rows) {
    close()
    currentId = id
    currentSocket = socket
    if (cols) ptyCols = cols
    if (rows) ptyRows = rows

    if (!isMobile()) {
      openDesktop(scrollback)
    } else {
      openMobile(scrollback)
    }
  }

  function openDesktop(scrollback) {
    term = new Terminal({
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace",
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      cols: ptyCols,
      rows: ptyRows,
    })

    fitAddon = new FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalContainer)

    if (scrollback) {
      term.write(scrollback)
    }

    // Handle user input
    term.onData(function (data) {
      if (currentSocket && currentId) {
        currentSocket.emit('session:input', { id: currentId, data: data })
      }
    })

    // Intercept paste for image support — let xterm handle text paste natively
    term.textarea.addEventListener('paste', function (ev) {
      var items = (ev.clipboardData || {}).items || []
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          ev.preventDefault()
          uploadImage(items[i].getAsFile())
          return
        }
      }
      // Text paste: don't preventDefault — let xterm handle it via onData
    })

    // No resize observer — remote uses PTY dimensions from the main terminal
  }

  function openMobile(scrollback) {
    mobileBuffer = scrollback || ''
    renderMobileOutput()
    // Auto-focus the input so the user can type immediately
    setTimeout(function () { mobileInput.focus() }, 300)
  }

  function renderMobileOutput() {
    if (mobileBuffer.length > MAX_MOBILE_BUFFER) {
      mobileBuffer = mobileBuffer.slice(-MAX_MOBILE_BUFFER)
    }
    // Strip all terminal escape sequences for mobile display
    var clean = mobileBuffer
      // OSC sequences: \x1b]...BEL or \x1b]...\x1b\\
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // CSI sequences: \x1b[?2004h, \x1b[1;32m, \x1b[0K, etc.
      .replace(/\x1b\[[?>=!]?[0-9;]*[a-zA-Z~]/g, '')
      // Character set and other two-char ESC sequences: \x1b(B, \x1b=, \x1b>
      .replace(/\x1b[()#][A-Za-z0-9]/g, '')
      .replace(/\x1b[=><]/g, '')
      // Any remaining lone ESC
      .replace(/\x1b/g, '')
      // Control chars (keep \n and \t)
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Collapse excessive blank lines
      .replace(/\n{4,}/g, '\n\n\n')
    mobileOutput.textContent = clean
    mobileOutput.scrollTop = mobileOutput.scrollHeight
  }



  function onData(data) {
    if (!isMobile() && term) {
      term.write(data)
    } else {
      mobileBuffer += data
      renderMobileOutput()
    }
  }

  function onExit(exitCode) {
    var msg = '\r\n[Session exited with code ' + exitCode + ']'
    if (!isMobile() && term) {
      term.write(msg)
    } else {
      mobileBuffer += msg
      renderMobileOutput()
    }
  }

  function close() {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (term) {
      term.dispose()
      term = null
      fitAddon = null
    }
    terminalContainer.innerHTML = ''
    mobileOutput.textContent = ''
    mobileBuffer = ''
    currentId = null
    currentSocket = null
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

  // Handle mobile virtual keyboard — resize terminal view to visible area
  if (window.visualViewport) {
    function adjustForKeyboard() {
      var termView = document.getElementById('terminal-view')
      if (termView && !termView.classList.contains('hidden')) {
        termView.style.height = window.visualViewport.height + 'px'
        mobileOutput.scrollTop = mobileOutput.scrollHeight
      }
    }
    window.visualViewport.addEventListener('resize', adjustForKeyboard)
    window.visualViewport.addEventListener('scroll', adjustForKeyboard)
  }

  // Expose globally
  window.CmdCLD_Terminal = { open: open, close: close, onData: onData, onExit: onExit }
})()
