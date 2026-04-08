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

    sessionCards.innerHTML = sessions.map(function (s) {
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
    terminalStatus.textContent = busyState[id] ? '⟳ Working' : '● Idle'
    terminalStatus.style.color = busyState[id] ? '#f59e0b' : '#10b981'

    dashboardView.style.display = 'none'
    terminalView.classList.remove('hidden')

    // Fetch full scrollback from server (includes everything since session started)
    fetch('/api/sessions/' + id + '/scrollback')
      .then(function (r) { return r.json() })
      .then(function (data) {
        window.CmdCLD_Terminal.open(id, data.scrollback || '', socket)
      })
      .catch(function () {
        window.CmdCLD_Terminal.open(id, '', socket)
      })
  }

  // Back to dashboard
  function closeTerminal() {
    window.CmdCLD_Terminal.close()
    currentSessionId = null
    terminalView.classList.add('hidden')
    dashboardView.style.display = ''
    refreshSessions()
  }

  // New session modal
  function showNewSessionModal() {
    newSessionModal.classList.remove('hidden')

    Promise.all([
      fetch('/api/folders/favorites').then(function (r) { return r.json() }).catch(function () { return [] }),
      fetch('/api/folders/recent').then(function (r) { return r.json() }).catch(function () { return [] }),
    ]).then(function (results) {
      var favRes = results[0]
      var recRes = results[1]
      var html = ''

      if (favRes.length > 0) {
        html += '<div class="folder-section-label">Favorites</div>'
        for (var i = 0; i < favRes.length; i++) {
          var f = favRes[i]
          var name = f.split(/[\\/]/).pop() || f
          html += '<div class="folder-item" data-path="' + escapeHtml(f) + '">' +
            escapeHtml(name) +
            '<div style="color:#666;font-size:10px;margin-top:2px">' + escapeHtml(f) + '</div>' +
          '</div>'
        }
      }

      if (recRes.length > 0) {
        html += '<div class="folder-section-label">Recent</div>'
        for (var j = 0; j < recRes.length; j++) {
          var r = recRes[j]
          html += '<div class="folder-item" data-path="' + escapeHtml(r.path) + '">' +
            escapeHtml(r.name) +
            '<div style="color:#666;font-size:10px;margin-top:2px">' + escapeHtml(r.path) + '</div>' +
          '</div>'
        }
      }

      if (favRes.length === 0 && recRes.length === 0) {
        html = '<div class="empty-state">No folders configured. Add favorites in the app settings.</div>'
      }

      folderSections.innerHTML = html

      var items = folderSections.querySelectorAll('.folder-item')
      for (var k = 0; k < items.length; k++) {
        (function (item) {
          item.addEventListener('click', function () {
            var path = item.dataset.path
            newSessionModal.classList.add('hidden')
            fetch('/api/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: path }),
            }).catch(function () {})
          })
        })(items[k])
      }
    })
  }

  // Event listeners
  newSessionBtn.addEventListener('click', showNewSessionModal)
  cancelNewSession.addEventListener('click', function () { newSessionModal.classList.add('hidden') })
  newSessionModal.querySelector('.modal-backdrop').addEventListener('click', function () { newSessionModal.classList.add('hidden') })
  backBtn.addEventListener('click', closeTerminal)

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
