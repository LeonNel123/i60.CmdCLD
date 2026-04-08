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
  var MAX_MOBILE_BUFFER = 100000

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
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
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

    // Handle paste — use DOM paste event (works on HTTP, unlike clipboard API)
    terminalContainer.addEventListener('paste', function (ev) {
      ev.preventDefault()
      var items = (ev.clipboardData || {}).items || []
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          uploadImage(items[i].getAsFile())
          return
        }
      }
      // Text paste
      var text = (ev.clipboardData || {}).getData('text/plain')
      if (text && currentSocket && currentId) {
        currentSocket.emit('session:input', { id: currentId, data: text })
      }
    })

    // Let Ctrl+V reach the DOM paste handler
    term.attachCustomKeyEventHandler(function (ev) {
      if (ev.ctrlKey && ev.key === 'v' && ev.type === 'keydown') {
        return false
      }
      return true
    })

    // No resize observer — remote uses PTY dimensions from the main terminal
  }

  function openMobile(scrollback) {
    mobileBuffer = scrollback || ''
    renderMobileOutput()
  }

  function renderMobileOutput() {
    if (mobileBuffer.length > MAX_MOBILE_BUFFER) {
      mobileBuffer = mobileBuffer.slice(-MAX_MOBILE_BUFFER)
    }
    // Strip ANSI codes for mobile display
    var clean = mobileBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
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
      currentSocket.emit('session:input', { id: currentId, data: text + '\n' })
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
          var decoded = input.replace(/&#10;/g, '\n')
          currentSocket.emit('session:input', { id: currentId, data: decoded })
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

  // Expose globally
  window.CmdCLD_Terminal = { open: open, close: close, onData: onData, onExit: onExit }
})()
