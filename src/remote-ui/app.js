// CmdCLD Remote — Main App Logic
(function () {
  'use strict'

  // State
  var sessions = []
  var currentSessionId = null
  var socket = null
  // id → { busy, since }. Tracked by the server (one clock for every client)
  // and converted to this device's clock on receipt.
  var activity = {}
  // id → when this phone last had the session open. A session that went idle
  // after that is "unseen" and floats to the top of the list.
  var SEEN_KEY = 'cmdcld-remote-seen'
  var seenAt = loadSeen()
  var remoteSettings = {
    defaultAgentCli: 'claude',
    claudeArgs: '',
    codexArgs: '',
    grokArgs: '',
    opencodeArgs: '',
    cliAvailability: null,
  }
  var selectedAgentCli = 'claude'

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
  var agentCliStatus = document.getElementById('agent-cli-status')

  function normalizeAgentCli(value) {
    return value === 'codex' || value === 'grok' || value === 'opencode' ? value : 'claude'
  }

  function refreshRemoteSettings() {
    return fetch('/api/settings')
      .then(function (r) { return r.json() })
      .then(function (s) {
        remoteSettings.defaultAgentCli = normalizeAgentCli(s.defaultAgentCli)
        remoteSettings.claudeArgs = s.claudeArgs || ''
        remoteSettings.codexArgs = s.codexArgs || ''
        remoteSettings.grokArgs = s.grokArgs || ''
        remoteSettings.opencodeArgs = s.opencodeArgs || ''
        remoteSettings.cliAvailability = s.cliAvailability || null
        selectedAgentCli = remoteSettings.defaultAgentCli
        renderAgentCliOptions()
      })
      .catch(function () {
        renderAgentCliOptions()
      })
  }

  function renderAgentCliOptions() {
    var buttons = document.querySelectorAll('.agent-cli-option')
    for (var i = 0; i < buttons.length; i++) {
      var cli = normalizeAgentCli(buttons[i].dataset.agentCli)
      buttons[i].classList.toggle('active', cli === selectedAgentCli)
    }
    if (!agentCliStatus) return
    var status = remoteSettings.cliAvailability && remoteSettings.cliAvailability[selectedAgentCli]
    agentCliStatus.classList.toggle('missing', !!status && !status.available)
    if (!status) {
      agentCliStatus.textContent = ''
    } else if (status.available) {
      agentCliStatus.textContent = 'available'
    } else {
      agentCliStatus.textContent = 'not found on PATH'
    }
  }

  // Connect Socket.IO
  function connect() {
    socket = io({ reconnection: true, reconnectionDelay: 1000 })

    socket.on('connect', function () {
      connectionStatus.textContent = 'Connected'
      connectionStatus.className = 'status-dot connected'
      // After a sleep or network change the open terminal missed output and
      // would show TUI repaints over a stale screen: reload it from scrollback,
      // or go back to the list if the session ended meanwhile.
      // On a fresh page load nothing is open yet, but the URL may name the
      // session that was (a reload, or the home-screen app resuming).
      var wasOpen = currentSessionId
      var openId = wasOpen || window.CmdCLD_Phone.sessionFromHash(location.hash)
      refreshSessions().then(function () {
        if (!openId || currentSessionId !== wasOpen) return
        if (sessionById(openId)) openTerminal(openId)
        else leaveTerminal()
      })
    })

    socket.on('disconnect', function () {
      connectionStatus.textContent = 'Disconnected'
      connectionStatus.className = 'status-dot disconnected'
    })

    socket.io.on('reconnect_attempt', function () {
      connectionStatus.textContent = 'Reconnecting...'
      connectionStatus.className = 'status-dot reconnecting'
    })

    socket.on('sessions:changed', applySessionList)

    socket.on('session:created', function () {
      refreshSessions()
    })

    // Only the open terminal's output arrives (see session:watch); the list
    // is driven by session:activity.
    socket.on('session:output', function (msg) {
      if (msg.id === currentSessionId) {
        window.CmdCLD_Terminal.onData(msg.data)
      }
    })

    socket.on('session:activity', function (msg) {
      if (!msg || typeof msg.id !== 'string') return
      setActivity(msg.id, msg.busy, msg.ageMs)
      renderTerminalStatus(msg.id)
      // Re-sort, not just relabel: a session that just finished belongs at
      // the top. These are rare — the server ignores single bursts of output.
      if (!currentSessionId) renderDashboard()
    })

    socket.on('session:exit', function (msg) {
      delete activity[msg.id]
      if (msg.id === currentSessionId) {
        window.CmdCLD_Terminal.onExit(msg.exitCode)
        renderTerminalStatus(msg.id)
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

  function loadSeen() {
    try {
      var parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (e) {}
    return {}
  }

  function markSeen(id) {
    seenAt[id] = Date.now()
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenAt)) } catch (e) {}
  }

  function sessionById(id) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === id) return sessions[i]
    return null
  }

  function setActivity(id, busy, ageMs) {
    activity[id] = { busy: !!busy, since: window.CmdCLD_Phone.localSince(ageMs, Date.now()) }
  }

  // A fresh session list from the server, each entry carrying its activity.
  function applySessionList(list) {
    sessions = Array.isArray(list) ? list : []
    var live = {}
    for (var i = 0; i < sessions.length; i++) {
      live[sessions[i].id] = true
      setActivity(sessions[i].id, sessions[i].busy, sessions[i].ageMs)
    }
    var id
    for (id in activity) if (!live[id]) delete activity[id]
    for (id in seenAt) if (!live[id]) delete seenAt[id]
    renderDashboard()
    if (currentSessionId) renderTerminalStatus(currentSessionId)
  }

  // Label for a session card: state, how long it has held, and whether it
  // finished since this phone last looked.
  function cardStatus(id) {
    var a = activity[id] || { busy: false, since: null }
    var age = a.since == null ? '' : window.CmdCLD_Phone.formatAge(Date.now() - a.since)
    if (a.busy) return { cls: 'busy', text: '⟳ Working' + (age ? ' ' + age : '') }
    var unseen = window.CmdCLD_Phone.isUnseen(a, seenAt[id])
    return { cls: unseen ? 'idle unseen' : 'idle', text: '● Idle' + (age ? ' ' + age : '') }
  }

  // Keep the "4m" on each card moving without rebuilding (or re-sorting) the
  // list under the user's thumb.
  function refreshCardLabels() {
    var cards = sessionCards.querySelectorAll('.session-card')
    for (var i = 0; i < cards.length; i++) {
      var label = cards[i].querySelector('.status-label')
      if (!label) continue
      var st = cardStatus(cards[i].dataset.id)
      label.className = 'status-label ' + st.cls
      label.textContent = st.text
    }
  }
  setInterval(function () {
    if (!currentSessionId && !document.hidden) refreshCardLabels()
  }, 20000)

  function renderTerminalStatus(id) {
    if (!terminalStatus || id !== currentSessionId) return
    var busy = !!(activity[id] && activity[id].busy)
    terminalStatus.textContent = '●'
    terminalStatus.className = 'terminal-status-dot ' + (busy ? 'busy' : 'idle')
    terminalStatus.title = busy ? 'Working' : 'Idle'
    terminalStatus.setAttribute('aria-label', busy ? 'Working' : 'Idle')
  }

  // Fetch sessions via REST
  function refreshSessions() {
    return fetch('/api/sessions')
      .then(function (r) { return r.json() })
      .then(applySessionList)
      .catch(function () {})
  }

  // Render dashboard
  function renderDashboard() {
    sessionCount.textContent = sessions.length + ' session' + (sessions.length !== 1 ? 's' : '')

    if (sessions.length === 0) {
      sessionCards.innerHTML = '<div class="empty-state">No active sessions</div>'
      return
    }

    // Finished-since-you-looked first, then working, then the rest.
    sessionCards.innerHTML = window.CmdCLD_Phone.sortForTriage(sessions, activity, seenAt).map(function (s) {
      var st = cardStatus(s.id)
      var statusClass = st.cls
      var statusText = st.text
      return '<div class="session-card" data-id="' + s.id + '" style="border-left-color: ' + (s.color || '#6366f1') + '">' +
        '<div class="card-info">' +
          '<h4>' + escapeHtml(s.name) + ' <span class="folder-badge">' + escapeHtml(normalizeAgentCli(s.agentCli)) + '</span></h4>' +
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

  // The open session lives in browser history, so the phone's Back gesture
  // returns to the list instead of leaving the page, and a reload reopens the
  // same terminal.
  function enterSessionHistory(id) {
    try {
      var hash = window.CmdCLD_Phone.sessionHash(id)
      var st = history.state
      if (st && st.s === id) return
      if (st && st.s) { history.replaceState({ s: id }, '', hash); return }
      // Arrived with the hash already in the URL (bookmark, reload without
      // state): put the list underneath so Back has somewhere to go.
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
      history.pushState({ s: id }, '', hash)
    } catch (e) {}
  }

  window.addEventListener('popstate', function () {
    var id = window.CmdCLD_Phone.sessionFromHash(location.hash)
    if (id && id !== currentSessionId && sessionById(id)) openTerminal(id, { fromHistory: true })
    else if (!id && currentSessionId) closeTerminal()
  })

  // Open terminal view for a session
  function openTerminal(id, opts) {
    var session = sessionById(id)
    if (!session) return
    currentSessionId = id
    markSeen(id)
    if (!(opts && opts.fromHistory)) enterSessionHistory(id)
    // From here the server streams this terminal's output to us (and no other).
    if (socket) socket.emit('session:watch', { id: id })

    terminalName.textContent = session.name
    document.title = session.name + ' — CmdCLD Remote'
    renderTerminalStatus(id)

    dashboardView.style.display = 'none'
    terminalView.style.height = ''
    terminalView.classList.remove('hidden')

    // Fetch full scrollback from server (includes everything since session started)
    fetch('/api/sessions/' + id + '/scrollback')
      .then(function (r) { return r.json() })
      .then(function (data) {
        // Another session was opened (or the list shown) while this loaded.
        if (currentSessionId !== id) return
        window.CmdCLD_Terminal.open(id, data.scrollback || '', socket, data.cols, data.rows)
      })
      .catch(function () {
        if (currentSessionId !== id) return
        window.CmdCLD_Terminal.open(id, '', socket)
      })
  }

  // Leave the terminal for the list — the Back button, Kill, and a session
  // that ended while we were away. Closes first and then drops the history
  // entry, so the view never depends on popstate arriving.
  function leaveTerminal() {
    var hadEntry = false
    try { hadEntry = !!(history.state && history.state.s) } catch (e) {}
    if (currentSessionId) closeTerminal()
    try {
      if (hadEntry) history.back()
      else if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    } catch (e) {}
  }

  // Back to dashboard
  function closeTerminal() {
    if (currentSessionId) markSeen(currentSessionId)
    if (socket) socket.emit('session:watch', { id: null })
    if (copySheet) closeCopySheet()
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
    var agentCli = normalizeAgentCli(selectedAgentCli)
    var existing = null
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].path === path && normalizeAgentCli(sessions[i].agentCli) === agentCli) { existing = sessions[i]; break }
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
      body: JSON.stringify({
        path: path,
        agentCli: agentCli,
        claudeArgs: remoteSettings.claudeArgs,
        codexArgs: remoteSettings.codexArgs,
        grokArgs: remoteSettings.grokArgs,
        opencodeArgs: remoteSettings.opencodeArgs,
      }),
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {} }).then(function (data) {
          alert('Could not open session: ' + (data.error || 'unknown error'))
        })
      }
      // Straight into the new session — landing on the list and tapping the
      // card that just appeared was an extra step every time.
      return r.json().then(function (data) {
        if (!data || !data.id) return
        return refreshSessions().then(function () { openTerminal(data.id) })
      })
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
        activeByPath[sessions[a].path + '|' + normalizeAgentCli(sessions[a].agentCli)] = sessions[a]
      }

      function buildItem(path, name, removable) {
        var active = !!activeByPath[path + '|' + normalizeAgentCli(selectedAgentCli)]
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
    refreshRemoteSettings().then(renderFolderSections)
    // Don't auto-focus the path input on mobile — same reason as the
    // terminal-view decision: no unsolicited keyboard popup.
  }

  // Event listeners
  newSessionBtn.addEventListener('click', showNewSessionModal)
  cancelNewSession.addEventListener('click', function () { newSessionModal.classList.add('hidden') })
  newSessionModal.querySelector('.modal-backdrop').addEventListener('click', function () { newSessionModal.classList.add('hidden') })
  var agentButtons = document.querySelectorAll('.agent-cli-option')
  for (var ab = 0; ab < agentButtons.length; ab++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        selectedAgentCli = normalizeAgentCli(btn.dataset.agentCli)
        renderAgentCliOptions()
        renderFolderSections()
      })
    })(agentButtons[ab])
  }
  backBtn.addEventListener('click', leaveTerminal)

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

  // Phone copy sheet. xterm cannot select by touch, so on a phone the Copy
  // button shows the output as plain text for the OS's own long-press
  // selection and copy menu, plus "Copy all".
  var copySheet = document.getElementById('copy-sheet')
  var copySheetText = document.getElementById('copy-sheet-text')
  var copySheetAll = document.getElementById('copy-sheet-all')
  function closeCopySheet() {
    copySheet.classList.add('hidden')
    copySheetText.textContent = ''
  }
  function openCopySheet() {
    copySheetText.textContent = window.CmdCLD_Terminal.bufferText()
    copySheet.classList.remove('hidden')
    // Latest output is what people usually want.
    copySheetText.scrollTop = copySheetText.scrollHeight
  }
  if (copySheet) {
    document.getElementById('copy-sheet-close').addEventListener('click', closeCopySheet)
    copySheet.querySelector('.modal-backdrop').addEventListener('click', closeCopySheet)
    copySheetAll.addEventListener('click', function () {
      var ok = window.CmdCLD_Terminal.copyText(copySheetText.textContent)
      copySheetAll.textContent = ok ? 'Copied' : 'Copy failed'
      setTimeout(function () { copySheetAll.textContent = 'Copy all' }, 1200)
    })
  }

  var copyBtn = document.getElementById('copy-btn')
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var T = window.CmdCLD_Terminal
      // Touch devices too: a phone in landscape is wider than isMobile() allows
      // but still cannot select in xterm by touch.
      var touch = false
      try { touch = window.matchMedia('(pointer: coarse)').matches } catch (e) {}
      if (copySheet && (T.isMobile() || touch) && !T.hasSelection()) {
        openCopySheet()
        return
      }
      var ok = T.copyOutput()
      // No clipboard permission prompt over plain http, so confirm visually.
      var previous = copyBtn.title
      copyBtn.title = ok ? 'Copied' : 'Copy failed'
      copyBtn.classList.toggle('copy-ok', !!ok)
      setTimeout(function () {
        copyBtn.title = previous
        copyBtn.classList.remove('copy-ok')
      }, 1200)
    })
  }

  ctrlCBtn.addEventListener('click', function () {
    if (currentSessionId && socket) {
      socket.emit('session:input', { id: currentSessionId, data: '\x03' })
    }
  })

  killBtn.addEventListener('click', function () {
    if (!currentSessionId) return
    if (!confirm('Kill this session?')) return
    fetch('/api/sessions/' + currentSessionId, { method: 'DELETE' })
      .then(function () { leaveTerminal() })
      .catch(function () {})
  })

  // Utils
  // Also quotes: the result goes into data-path="…" attributes, and a folder
  // name may legally contain a quote on macOS and Linux.
  function escapeHtml(str) {
    var div = document.createElement('div')
    div.textContent = str
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  // Expose for terminal-view.js
  window.CmdCLD_App = { closeTerminal: leaveTerminal, refreshSessions: refreshSessions }

  // Init
  connect()
  refreshRemoteSettings()
  refreshSessions()
})()
