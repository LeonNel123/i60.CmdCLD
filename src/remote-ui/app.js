// CmdCLD Remote — Main App Logic
(function () {
  'use strict'

  // State
  var sessions = []
  var currentSessionId = null
  var socket = null
  var busyTimers = {}
  var busyState = {}

  // DOM refs
  var dashboardView = document.getElementById('dashboard-view')
  var terminalView = document.getElementById('terminal-view')
  var sessionCards = document.getElementById('session-cards')
  var sessionCount = document.getElementById('session-count')
  var connectionStatus = document.getElementById('connection-status')
  var newSessionBtn = document.getElementById('new-session-btn')
  var newSessionModal = document.getElementById('new-session-modal')
  var folderSections = document.getElementById('folder-sections')
  var cancelNewSession = document.getElementById('cancel-new-session')
  var backBtn = document.getElementById('back-btn')
  var terminalName = document.getElementById('terminal-name')
  var terminalStatus = document.getElementById('terminal-status')
  var ctrlCBtn = document.getElementById('ctrl-c-btn')
  var killBtn = document.getElementById('kill-btn')

  // Connect Socket.IO
  function connect() {
    socket = io({ reconnection: true, reconnectionDelay: 1000 })

    socket.on('connect', function () {
      connectionStatus.textContent = 'Connected'
      connectionStatus.className = 'status-dot connected'
      refreshSessions()
    })

    socket.on('disconnect', function () {
      connectionStatus.textContent = 'Disconnected'
      connectionStatus.className = 'status-dot disconnected'
    })

    socket.io.on('reconnect_attempt', function () {
      connectionStatus.textContent = 'Reconnecting...'
      connectionStatus.className = 'status-dot reconnecting'
    })

    socket.on('sessions:changed', function (list) {
      sessions = list
      renderDashboard()
    })

    socket.on('session:created', function () {
      refreshSessions()
    })

    socket.on('session:output', function (msg) {
      trackBusy(msg.id, true)
      if (msg.id === currentSessionId) {
        window.CmdCLD_Terminal.onData(msg.data)
      }
    })

    socket.on('session:exit', function (msg) {
      trackBusy(msg.id, false)
      if (msg.id === currentSessionId) {
        window.CmdCLD_Terminal.onExit(msg.exitCode)
      }
      refreshSessions()
    })

    // Another client (desktop or another web tab) changed the PTY size.
    // Mirror it into our xterm without re-fitting — that would bounce the
    // active driver off the size and start a tug-of-war.
    socket.on('session:resize', function (msg) {
      if (msg && msg.id === currentSessionId && window.CmdCLD_Terminal.onResize) {
        window.CmdCLD_Terminal.onResize(msg.cols, msg.rows)
      }
    })
  }

  // Activity tracking — only update the status label, don't rebuild the DOM
  function trackBusy(id, dataReceived) {
    if (dataReceived) {
      var wasBusy = busyState[id]
      busyState[id] = true
      clearTimeout(busyTimers[id])
      busyTimers[id] = setTimeout(function () {
        busyState[id] = false
        updateCardStatus(id)
      }, 2000)
      if (!wasBusy) updateCardStatus(id)
    }
  }

  function updateCardStatus(id) {
    var card = sessionCards.querySelector('.session-card[data-id="' + id + '"]')
    if (!card) return
    var label = card.querySelector('.status-label')
    if (!label) return
    var busy = busyState[id]
    label.className = 'status-label ' + (busy ? 'busy' : 'idle')
    label.textContent = busy ? '⟳ Working...' : '● Idle'
  }

  // Fetch sessions via REST
  function refreshSessions() {
    fetch('/api/sessions')
      .then(function (r) { return r.json() })
      .then(function (list) {
        sessions = list
        renderDashboard()
      })
      .catch(function () {})
  }

  // Render dashboard
  function renderDashboard() {
    sessionCount.textContent = sessions.length + ' session' + (sessions.length !== 1 ? 's' : '')

    if (sessions.length === 0) {
      sessionCards.innerHTML = '<div class="empty-state">No active sessions</div>'
      return
    }

    sessionCards.innerHTML = sessions.slice().sort(function (a, b) { return a.name.localeCompare(b.name) }).map(function (s) {
      var busy = busyState[s.id]
      var statusClass = busy ? 'busy' : 'idle'
      var statusText = busy ? '⟳ Working...' : '● Idle'
      return '<div class="session-card" data-id="' + s.id + '" style="border-left-color: ' + (s.color || '#6366f1') + '">' +
        '<div class="card-info">' +
          '<h4>' + escapeHtml(s.name) + '</h4>' +
          '<div class="card-path">' + escapeHtml(s.path) + '</div>' +
        '</div>' +
        '<div class="card-status">' +
          '<span class="status-label ' + statusClass + '">' + statusText + '</span>' +
          '<span class="chevron">›</span>' +
        '</div>' +
      '</div>'
    }).join('')

    // Attach click handlers
    var cards = sessionCards.querySelectorAll('.session-card')
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener('click', function () {
          openTerminal(card.dataset.id)
        })
      })(cards[i])
    }
  }

  // Open terminal view for a session
  function openTerminal(id) {
    currentSessionId = id
    var session = null
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === id) { session = sessions[i]; break }
    }
    if (!session) return

    terminalName.textContent = session.name
    document.title = session.name + ' — CmdCLD Remote'
    terminalStatus.textContent = busyState[id] ? '⟳ Working' : '● Idle'
    terminalStatus.style.color = busyState[id] ? '#f59e0b' : '#10b981'

    dashboardView.style.display = 'none'
    terminalView.style.height = ''
    terminalView.classList.remove('hidden')

    // Fetch full scrollback from server (includes everything since session started)
    fetch('/api/sessions/' + id + '/scrollback')
      .then(function (r) { return r.json() })
      .then(function (data) {
        window.CmdCLD_Terminal.open(id, data.scrollback || '', socket, data.cols, data.rows)
      })
      .catch(function () {
        window.CmdCLD_Terminal.open(id, '', socket)
      })
  }

  // Back to dashboard
  function closeTerminal() {
    // Blur the mobile input so the virtual keyboard dismisses before we
    // navigate away — prevents the next session from inheriting a
    // keyboard-sized viewport height.
    var mobileInput = document.getElementById('mobile-input')
    if (mobileInput) mobileInput.blur()

    window.CmdCLD_Terminal.close()
    currentSessionId = null
    document.title = 'CmdCLD Remote'
    terminalView.style.height = ''
    terminalView.classList.add('hidden')
    dashboardView.style.display = ''
    refreshSessions()
  }

  // Open a session for a given path. If a session for this path is already
  // running, navigate to that one instead of creating a duplicate.
  function openOrCreateSession(path) {
    var existing = null
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].path === path) { existing = sessions[i]; break }
    }
    if (existing) {
      newSessionModal.classList.add('hidden')
      openTerminal(existing.id)
      return
    }
    newSessionModal.classList.add('hidden')
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path }),
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {} }).then(function (data) {
          alert('Could not open session: ' + (data.error || 'unknown error'))
        })
      }
    }).catch(function () {
      alert('Could not open session (network error)')
    })
  }

  // Remove a folder from the recent list and refresh the modal.
  function removeRecent(path) {
    fetch('/api/folders/recent', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path }),
    }).then(function () {
      renderFolderSections() // refresh the modal in place
    }).catch(function () {})
  }

  // Render the favorites + recent sections inside the modal. Marks folders
  // that already have an active session with a running badge.
  function renderFolderSections() {
    var folderSections = document.getElementById('folder-sections')
    Promise.all([
      fetch('/api/folders/favorites').then(function (r) { return r.json() }).catch(function () { return [] }),
      fetch('/api/folders/recent').then(function (r) { return r.json() }).catch(function () { return [] }),
    ]).then(function (results) {
      var favRes = results[0]
      var recRes = results[1]

      // Map path → active session (if any) for quick lookup
      var activeByPath = {}
      for (var a = 0; a < sessions.length; a++) {
        activeByPath[sessions[a].path] = sessions[a]
      }

      function buildItem(path, name, removable) {
        var active = !!activeByPath[path]
        return '<div class="folder-item' + (active ? ' folder-item-active' : '') + '" data-path="' + escapeHtml(path) + '">' +
          '<div class="folder-info">' +
            '<div class="folder-name">' + escapeHtml(name) + (active ? ' <span class="folder-badge">● running</span>' : '') + '</div>' +
            '<div class="folder-path">' + escapeHtml(path) + '</div>' +
          '</div>' +
          (removable ? '<button class="folder-remove" data-path="' + escapeHtml(path) + '" title="Remove from recents">×</button>' : '') +
        '</div>'
      }

      var html = ''
      if (favRes.length > 0) {
        favRes.sort(function (a, b) { return a.localeCompare(b) })
        html += '<div class="folder-section-label">Favorites</div>'
        for (var i = 0; i < favRes.length; i++) {
          var f = favRes[i]
          var fname = f.split(/[\\/]/).pop() || f
          html += buildItem(f, fname, false)
        }
      }

      if (recRes.length > 0) {
        recRes.sort(function (a, b) { return a.name.localeCompare(b.name) })
        html += '<div class="folder-section-label">Recent</div>'
        for (var j = 0; j < recRes.length; j++) {
          var r = recRes[j]
          html += buildItem(r.path, r.name, true)
        }
      }

      if (favRes.length === 0 && recRes.length === 0) {
        html = '<div class="empty-state">No favorites or recents yet. Paste a folder path above to open one.</div>'
      }

      folderSections.innerHTML = html

      // Attach click handlers — open (or navigate) on item click, delete on × click
      var items = folderSections.querySelectorAll('.folder-item')
      for (var k = 0; k < items.length; k++) {
        (function (item) {
          item.addEventListener('click', function (e) {
            // Ignore clicks on the × button
            if (e.target && e.target.classList && e.target.classList.contains('folder-remove')) return
            openOrCreateSession(item.dataset.path)
          })
        })(items[k])
      }
      var removes = folderSections.querySelectorAll('.folder-remove')
      for (var m = 0; m < removes.length; m++) {
        (function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation()
            removeRecent(btn.dataset.path)
          })
        })(removes[m])
      }
    })
  }

  // New session modal
  function showNewSessionModal() {
    newSessionModal.classList.remove('hidden')
    var input = document.getElementById('custom-path-input')
    var errEl = document.getElementById('custom-path-error')
    if (input) input.value = ''
    if (errEl) errEl.textContent = ''
    renderFolderSections()
    // Don't auto-focus the path input on mobile — same reason as the
    // terminal-view decision: no unsolicited keyboard popup.
  }

  // Event listeners
  newSessionBtn.addEventListener('click', showNewSessionModal)
  cancelNewSession.addEventListener('click', function () { newSessionModal.classList.add('hidden') })
  newSessionModal.querySelector('.modal-backdrop').addEventListener('click', function () { newSessionModal.classList.add('hidden') })
  backBtn.addEventListener('click', closeTerminal)

  var newFromTerminalBtn = document.getElementById('new-from-terminal-btn')
  if (newFromTerminalBtn) {
    newFromTerminalBtn.addEventListener('click', function () {
      closeTerminal()
      showNewSessionModal()
    })
  }

  // Custom path input — submit on Open button click or Enter key
  var customPathInput = document.getElementById('custom-path-input')
  var customPathOpen = document.getElementById('custom-path-open')
  var customPathError = document.getElementById('custom-path-error')
  function submitCustomPath() {
    if (!customPathInput) return
    var path = customPathInput.value.trim()
    if (!path) {
      if (customPathError) customPathError.textContent = 'Please enter a path'
      return
    }
    if (customPathError) customPathError.textContent = ''
    openOrCreateSession(path)
  }
  if (customPathOpen) customPathOpen.addEventListener('click', submitCustomPath)
  if (customPathInput) customPathInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitCustomPath() }
  })

  ctrlCBtn.addEventListener('click', function () {
    if (currentSessionId && socket) {
      socket.emit('session:input', { id: currentSessionId, data: '\x03' })
    }
  })

  killBtn.addEventListener('click', function () {
    if (!currentSessionId) return
    if (!confirm('Kill this session?')) return
    fetch('/api/sessions/' + currentSessionId, { method: 'DELETE' })
      .then(function () { closeTerminal() })
      .catch(function () {})
  })

  // Utils
  function escapeHtml(str) {
    var div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // Expose for terminal-view.js
  window.CmdCLD_App = { closeTerminal: closeTerminal, refreshSessions: refreshSessions }

  // Init
  connect()
  refreshSessions()
})()
