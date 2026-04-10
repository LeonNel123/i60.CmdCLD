// Mobile view test harness
// Spins up a minimal express server that mimics remote-server.ts static file
// routing, then launches headless Chrome with a mobile viewport to verify the
// page renders, xterm attaches, quick-action buttons are present, and nothing
// throws in the browser console.
//
// Run: node scripts/test-mobile-view.js

const express = require('express')
const http = require('http')
const { spawn } = require('child_process')
const { join } = require('path')
const { existsSync, writeFileSync, readFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')

const ROOT = join(__dirname, '..')
const UI_DIR = join(ROOT, 'src/remote-ui')
const NODE_MODULES = join(ROOT, 'node_modules')

const PORT = 17531
const LOG = []
const log = (...args) => { const s = args.join(' '); console.log(s); LOG.push(s) }

const app = express()
// Probe page served from same origin so it can fetch('/') without CORS
app.get('/probe.html', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"></head><body>
<pre id="out">loading…</pre>
<script>
fetch('/').then(r => r.text()).then(html => {
  var parser = new DOMParser()
  var doc = parser.parseFromString(html, 'text/html')
  var btns = doc.querySelectorAll('#quick-actions .quick-btn')
  var results = []
  btns.forEach(function(b) {
    var v = b.getAttribute('data-input') || ''
    results.push({
      label: b.textContent.trim(),
      length: v.length,
      endsWithCR: v.charCodeAt(v.length - 1) === 13,
      lastCharCode: v.charCodeAt(v.length - 1),
      preview: v.substring(0, 60),
    })
  })
  document.getElementById('out').textContent = JSON.stringify(results, null, 2)
}).catch(function(e){ document.getElementById('out').textContent = 'ERR ' + e.message })
</script>
</body></html>`)
})
app.use('/vendor/xterm', express.static(join(NODE_MODULES, '@xterm/xterm')))
app.get('/vendor/xterm-addon-fit/lib/xterm-addon-fit.js', (_req, res) => {
  res.sendFile(join(NODE_MODULES, '@xterm/addon-fit/lib/addon-fit.js'))
})
// Stub socket.io so the client's `io()` call doesn't 404
app.get('/socket.io/socket.io.js', (_req, res) => {
  res.type('application/javascript').send(
    'window.io = function () { return { on: function(){}, emit: function(){}, io: { on: function(){} } } }'
  )
})
// Stub REST endpoints the client hits on load
app.get('/api/sessions', (_req, res) => res.json([]))
app.get('/api/folders/favorites', (_req, res) => res.json([]))
app.get('/api/folders/recent', (_req, res) => res.json([]))
app.use(express.static(UI_DIR))
app.get('/', (_req, res) => res.sendFile(join(UI_DIR, 'index.html')))
// Test-only route: serve index.html with the terminal view pre-opened so we
// can screenshot the actual mobile terminal layout with quick-action buttons.
app.get('/test-terminal', (_req, res) => {
  // Build a scrollback that simulates Claude's spinner using \r (the most
  // common pattern): each frame starts with \r (cursor to col 0) then writes
  // the full text, overwriting the previous frame in place. Ten frames.
  // A correct terminal emulator shows exactly one spinner line.
  var frames = ['⎾', '⎿', '⎽', '⎼', '⎾', '⎿', '⎽', '⎼', '⎾', '⎿']
  var spinner = ''
  for (var i = 0; i < frames.length; i++) {
    spinner += '\r' + frames[i] + ' (thinking with high effort)'
  }
  spinner += '\r\n' // finish the spinner line
  // Also include some content to verify normal output renders with ANSI colors.
  var prelude =
    '\x1b[36m╭─ Claude ─╮\x1b[0m\r\n' +
    '\x1b[36m│\x1b[0m \x1b[32m$\x1b[0m Ready to help.\r\n' +
    '\x1b[36m╰──────────╯\x1b[0m\r\n' +
    '\x1b[1mHello\x1b[0m, this is \x1b[31mcolored\x1b[0m text with \x1b[33mANSI\x1b[0m codes.\r\n'
  var scrollback = prelude + spinner + 'Done.\r\n'

  const html = readFileSync(join(UI_DIR, 'index.html'), 'utf8')
    .replace('<div id="terminal-view" class="hidden">', '<div id="terminal-view">')
    .replace('<div id="dashboard-view">', '<div id="dashboard-view" style="display:none">')
    .replace('<span id="terminal-name"></span>', '<span id="terminal-name">test-session</span>')
    .replace('<span id="terminal-status"></span>', '<span id="terminal-status" style="color:#10b981">● Idle</span>')
    + `<script>
(function () {
  var scrollback = ${JSON.stringify(scrollback)}
  function tryOpen() {
    if (!window.CmdCLD_Terminal) return setTimeout(tryOpen, 50)
    var fakeSocket = { emit: function(){}, on: function(){}, io: { on: function(){} } }
    try {
      window.CmdCLD_Terminal.open('test', scrollback, fakeSocket, 80, 24)
      // Stash a flag for the test probe to read
      window.__TEST_OPENED__ = true
      // Dump visible terminal buffer after a short delay
      setTimeout(function () {
        try {
          // Access xterm via known globals — we can find the Terminal by
          // querying the .xterm DOM element and reading data-attribute on it,
          // but simpler: read the .xterm-rows DOM.
          var rows = document.querySelectorAll('.xterm-rows > div')
          var lines = []
          rows.forEach(function (r) { lines.push(r.textContent) })
          window.__TEST_TERMINAL_LINES__ = lines
          // Count how many lines contain '(thinking with high effort)'
          var count = 0
          lines.forEach(function (l) { if (l.indexOf('(thinking with high effort)') !== -1) count++ })
          window.__TEST_SPINNER_COUNT__ = count
        } catch (e) {
          window.__TEST_ERROR__ = e.message
        }
      }, 500)
    } catch (e) {
      window.__TEST_ERROR__ = e.message
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryOpen)
  } else {
    tryOpen()
  }
})()
</script>`
  res.type('html').send(html)
})

// Test-only route: dashboard with new-session modal pre-opened with mock data
app.get('/test-new-session', (_req, res) => {
  // Override the folder + session APIs with fake data for the screenshot
  app.get('/api/folders/favorites', (_q, r) => r.json(['I:/i60-Projects/i60.CmdCLD', 'I:/projects/my-website']))
  const html = readFileSync(join(UI_DIR, 'index.html'), 'utf8')
    .replace('<div id="new-session-modal" class="modal hidden">', '<div id="new-session-modal" class="modal">')
    + `<script>
(function () {
  setTimeout(function () {
    // Inject fake sessions so "running" badge shows
    if (window.CmdCLD_App) {
      // Mock by hand
    }
    // Fake favorites + recents into the modal
    var fs = document.getElementById('folder-sections')
    if (fs) {
      fs.innerHTML = \`
        <div class="folder-section-label">Favorites</div>
        <div class="folder-item">
          <div class="folder-info">
            <div class="folder-name">CmdCLD</div>
            <div class="folder-path">I:/i60-Projects/i60.CmdCLD</div>
          </div>
        </div>
        <div class="folder-item">
          <div class="folder-info">
            <div class="folder-name">my-website</div>
            <div class="folder-path">I:/projects/my-website</div>
          </div>
        </div>
        <div class="folder-section-label">Recent</div>
        <div class="folder-item folder-item-active">
          <div class="folder-info">
            <div class="folder-name">api-server <span class="folder-badge">● running</span></div>
            <div class="folder-path">I:/projects/api-server</div>
          </div>
          <button class="folder-remove" title="Remove from recents">×</button>
        </div>
        <div class="folder-item">
          <div class="folder-info">
            <div class="folder-name">experiment-branch</div>
            <div class="folder-path">I:/scratch/experiment-branch</div>
          </div>
          <button class="folder-remove" title="Remove from recents">×</button>
        </div>
        <div class="folder-item">
          <div class="folder-info">
            <div class="folder-name">docs</div>
            <div class="folder-path">I:/work/docs</div>
          </div>
          <button class="folder-remove" title="Remove from recents">×</button>
        </div>
      \`
    }
  }, 200)
})()
</script>`
  res.type('html').send(html)
})

// Test-only route: terminal view with help modal pre-opened for screenshot
app.get('/test-help-open', (_req, res) => {
  const html = readFileSync(join(UI_DIR, 'index.html'), 'utf8')
    .replace('<div id="terminal-view" class="hidden">', '<div id="terminal-view">')
    .replace('<div id="dashboard-view">', '<div id="dashboard-view" style="display:none">')
    .replace('<span id="terminal-name"></span>', '<span id="terminal-name">test-session</span>')
    .replace('<span id="terminal-status"></span>', '<span id="terminal-status" style="color:#10b981">● Idle</span>')
    .replace('<div id="help-modal" class="modal hidden">', '<div id="help-modal" class="modal">')
  res.type('html').send(html)
})

// Probe endpoint: verify the font-size controls and help modal work
app.get('/test-font-help', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body>
<pre id="out">loading…</pre>
<iframe id="f" src="/test-terminal" style="width:412px;height:915px;border:0"></iframe>
<script>
setTimeout(function () {
  try {
    var w = document.getElementById('f').contentWindow
    var doc = w.document
    // Clear any stale localStorage from previous runs
    try { w.localStorage.removeItem('cmdcld-remote-mobile-font-size') } catch (e) {}
    // Re-open so it picks up the cleared default
    var fakeSocket = { emit: function () {}, on: function () {}, io: { on: function () {} } }
    w.CmdCLD_Terminal.open('test', '', fakeSocket, 80, 24)
    // Read the freshly-created xterm terminal's fontSize
    var termEl = doc.querySelector('.xterm')
    // There's no direct DOM way to read xterm font size — instead measure the
    // width of a rendered cell via xterm-rows > span getBoundingClientRect.
    function measureFont () {
      var row = doc.querySelector('.xterm-rows')
      if (!row) return null
      var cs = doc.defaultView.getComputedStyle(row)
      return parseFloat(cs.fontSize)
    }
    var initialFont = measureFont()
    // Click A+ twice
    doc.getElementById('font-inc-btn').click()
    doc.getElementById('font-inc-btn').click()
    var afterInc = measureFont()
    var stored = w.localStorage.getItem('cmdcld-remote-mobile-font-size')
    // Click A- once
    doc.getElementById('font-dec-btn').click()
    var afterDec = measureFont()
    // Test help modal
    var helpModal = doc.getElementById('help-modal')
    var wasHidden = helpModal.classList.contains('hidden')
    doc.getElementById('help-btn').click()
    var afterClick = !helpModal.classList.contains('hidden')
    doc.getElementById('close-help').click()
    var afterClose = helpModal.classList.contains('hidden')

    document.getElementById('out').textContent = JSON.stringify({
      initialFont: initialFont,
      afterIncTwice: afterInc,
      afterDecOnce: afterDec,
      storedValue: stored,
      helpInitiallyHidden: wasHidden,
      helpOpensOnClick: afterClick,
      helpClosesOnClick: afterClose,
    }, null, 2)
  } catch (e) {
    document.getElementById('out').textContent = 'ERR ' + e.message + '\\n' + e.stack
  }
}, 2000)
</script>
</body></html>`)
})

// Probe endpoint: click each quick-action button inside the test iframe and
// record what data the socket "received", proving the end-to-end click → CR-
// terminated message → socket.emit path works.
app.get('/test-clicks', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body>
<pre id="out">loading…</pre>
<iframe id="f" src="/test-terminal" style="width:412px;height:915px;border:0"></iframe>
<script>
setTimeout(function () {
  try {
    var w = document.getElementById('f').contentWindow
    var doc = w.document
    // Intercept the fake socket's emit by replacing it with a recorder
    var emissions = []
    var origOpen = w.CmdCLD_Terminal.open
    // Re-open with a recording socket so subsequent emits are captured
    var recordingSocket = {
      emit: function (event, payload) { emissions.push({ event: event, payload: payload }) },
      on: function () {},
      io: { on: function () {} },
    }
    w.CmdCLD_Terminal.open('test', '', recordingSocket, 80, 24)
    // Click every quick-action button
    var btns = doc.querySelectorAll('#quick-actions .quick-btn')
    btns.forEach(function (b) { b.click() })
    // Report
    var report = emissions.map(function (e) {
      var d = e.payload && e.payload.data || ''
      return {
        event: e.event,
        length: d.length,
        endsWithCR: d.charCodeAt(d.length - 1) === 13,
        preview: d.substring(0, 50).replace(/\\r/g, '\\\\r').replace(/\\n/g, '\\\\n'),
      }
    })
    document.getElementById('out').textContent = JSON.stringify({ count: report.length, items: report }, null, 2)
  } catch (e) {
    document.getElementById('out').textContent = 'ERR ' + e.message
  }
}, 2000)
</script>
</body></html>`)
})

// Probe endpoint: measure each quick-action button position
app.get('/test-btn-positions', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body>
<pre id="out">loading…</pre>
<iframe id="f" src="/test-terminal" style="width:412px;height:915px;border:0"></iframe>
<script>
setTimeout(function () {
  try {
    var doc = document.getElementById('f').contentDocument
    var btns = doc.querySelectorAll('#quick-actions .quick-btn')
    var results = []
    btns.forEach(function (b) {
      var r = b.getBoundingClientRect()
      results.push({
        label: b.textContent.trim(),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right),
      })
    })
    var qa = doc.getElementById('quick-actions')
    var qr = qa.getBoundingClientRect()
    document.getElementById('out').textContent = JSON.stringify({
      quickActionsBox: { x: Math.round(qr.left), y: Math.round(qr.top), w: Math.round(qr.width), h: Math.round(qr.height) },
      buttons: results,
    }, null, 2)
  } catch (e) {
    document.getElementById('out').textContent = 'ERR ' + e.message
  }
}, 2000)
</script>
</body></html>`)
})

// Probe endpoint: measure element widths to find horizontal overflow
app.get('/test-widths', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body>
<pre id="out">loading…</pre>
<iframe id="f" src="/test-terminal" style="width:412px;height:915px;border:0"></iframe>
<script>
setTimeout(function () {
  try {
    var doc = document.getElementById('f').contentDocument
    var ids = ['app', 'terminal-view', 'terminal-header', 'back-btn', 'font-dec-btn', 'font-inc-btn', 'help-btn', 'ctrl-c-btn', 'kill-btn', 'mobile-terminal', 'mobile-output', 'quick-actions', 'mobile-input-bar', 'mobile-input', 'mobile-send-btn', 'mobile-image-btn']
    var results = {}
    ids.forEach(function (id) {
      var el = doc.getElementById(id)
      if (el) {
        var r = el.getBoundingClientRect()
        var cs = doc.defaultView.getComputedStyle(el)
        results[id] = {
          width: Math.round(r.width),
          height: Math.round(r.height),
          right: Math.round(r.right),
          scrollWidth: el.scrollWidth,
          overflow: cs.overflowX,
          flex: cs.flex,
          minWidth: cs.minWidth,
        }
      }
    })
    // Also check xterm screen
    var xterm = doc.querySelector('.xterm-screen')
    if (xterm) {
      var r = xterm.getBoundingClientRect()
      results['xterm-screen'] = { width: Math.round(r.width), right: Math.round(r.right) }
    }
    results.__viewport = { innerWidth: doc.defaultView.innerWidth }
    document.getElementById('out').textContent = JSON.stringify(results, null, 2)
  } catch (e) {
    document.getElementById('out').textContent = 'ERR ' + e.message
  }
}, 2000)
</script>
</body></html>`)
})

// Probe endpoint the test can poll to read the window globals set above
app.get('/test-terminal-probe', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body>
<pre id="out">loading…</pre>
<iframe id="f" src="/test-terminal" style="width:412px;height:915px"></iframe>
<script>
setTimeout(function () {
  try {
    var w = document.getElementById('f').contentWindow
    var result = {
      opened: !!w.__TEST_OPENED__,
      error: w.__TEST_ERROR__ || null,
      spinnerCount: w.__TEST_SPINNER_COUNT__,
      lineCount: w.__TEST_TERMINAL_LINES__ ? w.__TEST_TERMINAL_LINES__.length : 0,
      lines: (w.__TEST_TERMINAL_LINES__ || []).filter(function (l) { return l.trim() }).slice(0, 20),
      hasXterm: !!document.getElementById('f').contentDocument.querySelector('.xterm'),
    }
    document.getElementById('out').textContent = JSON.stringify(result, null, 2)
  } catch (e) {
    document.getElementById('out').textContent = 'ERR ' + e.message
  }
}, 1500)
</script>
</body></html>`)
})

const server = http.createServer(app)

function findChrome() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

async function runTest() {
  const chrome = findChrome()
  if (!chrome) {
    log('ERROR: No Chrome or Edge binary found')
    process.exit(1)
  }
  log('Using browser:', chrome)

  // Launch headless with mobile viewport
  const profileDir = join(tmpdir(), 'cmdcld-test-' + Date.now())
  const screenshot = join(ROOT, 'test-mobile-view.png')
  const screenshotTerminal = join(ROOT, 'test-mobile-terminal.png')
  const consoleLog = join(ROOT, 'test-mobile-console.log')

  // Use --dump-dom to get the rendered DOM and --virtual-time-budget to let JS run
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=412,915', // Pixel 7 size
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    '--user-data-dir=' + profileDir,
    '--virtual-time-budget=5000',
    '--screenshot=' + screenshot,
    '--enable-logging',
    '--v=1',
    '--log-file=' + consoleLog,
    `http://localhost:${PORT}/`,
  ]

  log('Launching browser...')
  const proc = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (d) => { stdout += d.toString() })
  proc.stderr.on('data', (d) => { stderr += d.toString() })

  await new Promise((resolve) => {
    proc.on('exit', (code) => {
      log('Browser exited with code', code)
      resolve()
    })
    // Safety timeout
    setTimeout(() => { try { proc.kill() } catch {} ; resolve() }, 15000)
  })

  // Report results
  const screenshotExists = existsSync(screenshot)
  log('Screenshot created:', screenshotExists ? 'YES' : 'NO', screenshot)

  if (stderr) {
    const errLines = stderr.split('\n').filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'))
    if (errLines.length) {
      log('\n-- Browser stderr errors --')
      errLines.slice(0, 20).forEach(l => log(l))
    }
  }

  // Try to also dump the DOM via a second call
  const domArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=412,915',
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    '--user-data-dir=' + profileDir + '-dom',
    '--virtual-time-budget=5000',
    '--dump-dom',
    `http://localhost:${PORT}/`,
  ]
  log('\nDumping rendered DOM...')
  const dom = await new Promise((resolve) => {
    const p = spawn(chrome, domArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('exit', () => resolve(out))
    setTimeout(() => { try { p.kill() } catch {} ; resolve(out) }, 15000)
  })

  // Checks on rendered DOM
  const checks = [
    { name: 'has #app',                   ok: dom.includes('id="app"') },
    { name: 'has #quick-actions',         ok: dom.includes('id="quick-actions"') },
    { name: 'has FY button',              ok: dom.includes('>FY</button>') },
    { name: 'has NF button',              ok: dom.includes('>NF</button>') },
    { name: 'has CR button',              ok: dom.includes('>CR</button>') },
    { name: 'has SR button',              ok: dom.includes('>SR</button>') },
    { name: 'has UI button',              ok: dom.includes('>UI</button>') },
    { name: 'has Clr button',             ok: dom.includes('>Clr</button>') },
    { name: 'quick-btn-danger on Clr/FY', ok: (dom.match(/quick-btn-danger/g) || []).length >= 2 },
    { name: 'has #mobile-terminal',       ok: dom.includes('id="mobile-terminal"') },
    { name: 'has #mobile-output',         ok: dom.includes('id="mobile-output"') },
    { name: 'has #mobile-input',          ok: dom.includes('id="mobile-input"') },
    { name: 'terminal-view has "hidden"', ok: dom.includes('id="terminal-view"') && dom.match(/id="terminal-view"[^>]*class="[^"]*hidden/) !== null },
  ]

  log('\n-- DOM checks --')
  let pass = 0, fail = 0
  for (const c of checks) {
    if (c.ok) { pass++; log('PASS:', c.name) }
    else { fail++; log('FAIL:', c.name) }
  }
  log(`\n${pass}/${pass + fail} checks passed`)

  // Dump first 2000 chars of quick-actions block for visual inspection
  const qaMatch = dom.match(/<div id="quick-actions"[\s\S]*?<\/div>/)
  if (qaMatch) {
    log('\n-- quick-actions rendered markup (truncated) --')
    log(qaMatch[0].substring(0, 2500))
  }

  // Raw text check: verify source HTML has &#13; at end of each data-input
  log('\n-- Raw source &#13; check --')
  const indexHtml = readFileSync(join(UI_DIR, 'index.html'), 'utf8')
  const qaBlockMatch = indexHtml.match(/<div id="quick-actions">([\s\S]*?)<\/div>/)
  if (qaBlockMatch) {
    const dataInputPattern = /data-input="([^"]*)"/g
    let m
    let rawPass = 0, rawFail = 0
    const labelPattern = />([^<]+)<\/button>/g
    const block = qaBlockMatch[1]
    const values = []
    while ((m = dataInputPattern.exec(block)) !== null) values.push(m[1])
    const labels = []
    let l
    while ((l = labelPattern.exec(block)) !== null) labels.push(l[1].trim())
    values.forEach((v, i) => {
      const endsWithCR = v.endsWith('&#13;')
      const label = labels[i] || '?'
      if (endsWithCR) { rawPass++; log('PASS:', label, 'has &#13;') }
      else { rawFail++; log('FAIL:', label, 'missing &#13;:', v.substring(0, 50)) }
    })
    log(`Raw source: ${rawPass}/${rawPass + rawFail} buttons have &#13;`)
    if (rawFail > 0) fail += rawFail
  } else {
    log('FAIL: could not find #quick-actions block in source HTML')
    fail++
  }

  // Runtime check via browser: parse the actual dataset value and confirm CR
  log('\n-- Runtime dataset CR check (via browser) --')
  const probeArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + profileDir + '-probe',
    '--virtual-time-budget=5000',
    '--dump-dom',
    `http://localhost:${PORT}/probe.html`,
  ]
  const probeDom = await new Promise((resolve) => {
    const p = spawn(chrome, probeArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('exit', () => resolve(out))
    setTimeout(() => { try { p.kill() } catch {} ; resolve(out) }, 15000)
  })

  // Extract JSON from the <pre id="out"> element
  const preMatch = probeDom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  if (preMatch) {
    const jsonText = preMatch[1].trim()
    try {
      const results = JSON.parse(jsonText)
      let rtPass = 0, rtFail = 0
      results.forEach(r => {
        if (r.endsWithCR) { rtPass++; log('PASS:', r.label, '(len=' + r.length + ', ends with CR)') }
        else { rtFail++; log('FAIL:', r.label, '(len=' + r.length + ', last code=' + r.lastCharCode + ', preview="' + r.preview + '")') }
      })
      log(`Runtime CR: ${rtPass}/${rtPass + rtFail}`)
      if (rtFail > 0) fail += rtFail
    } catch (e) {
      log('Could not parse probe result:', e.message)
      log('Pre body:', jsonText.substring(0, 500))
    }
  } else {
    log('Could not find #out pre in dumped DOM')
    log('DOM head (500):', probeDom.substring(0, 500))
  }

  try { rmSync(profileDir + '-probe', { recursive: true, force: true }) } catch {}

  // Take a screenshot of the terminal view with quick-action buttons visible
  log('\n-- Screenshotting terminal view --')
  const termArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=412,915',
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    '--user-data-dir=' + profileDir + '-term',
    '--virtual-time-budget=5000',
    '--screenshot=' + screenshotTerminal,
    `http://localhost:${PORT}/test-terminal`,
  ]
  await new Promise((resolve) => {
    const p = spawn(chrome, termArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    p.on('exit', () => resolve())
    setTimeout(() => { try { p.kill() } catch {} ; resolve() }, 15000)
  })
  log('Terminal screenshot:', existsSync(screenshotTerminal) ? 'YES' : 'NO', screenshotTerminal)
  try { rmSync(profileDir + '-term', { recursive: true, force: true }) } catch {}

  // Wider screenshot to see button layout without clipping
  const screenshotWide = join(ROOT, 'test-mobile-wide.png')
  const wideArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=500,915',
    '--user-data-dir=' + profileDir + '-wide',
    '--virtual-time-budget=5000',
    '--screenshot=' + screenshotWide,
    `http://localhost:${PORT}/test-terminal`,
  ]
  await new Promise((resolve) => {
    const p = spawn(chrome, wideArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    p.on('exit', () => resolve())
    setTimeout(() => { try { p.kill() } catch {} ; resolve() }, 15000)
  })
  log('Wide screenshot:', existsSync(screenshotWide) ? 'YES' : 'NO', screenshotWide)
  try { rmSync(profileDir + '-wide', { recursive: true, force: true }) } catch {}

  // Screenshot the help modal
  const screenshotHelp = join(ROOT, 'test-mobile-help.png')
  const helpArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=412,915',
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    '--user-data-dir=' + profileDir + '-help',
    '--virtual-time-budget=5000',
    '--screenshot=' + screenshotHelp,
    `http://localhost:${PORT}/test-help-open`,
  ]
  await new Promise((resolve) => {
    const p = spawn(chrome, helpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    p.on('exit', () => resolve())
    setTimeout(() => { try { p.kill() } catch {} ; resolve() }, 15000)
  })
  log('Help modal screenshot:', existsSync(screenshotHelp) ? 'YES' : 'NO', screenshotHelp)
  try { rmSync(profileDir + '-help', { recursive: true, force: true }) } catch {}

  // Screenshot the new-session modal with custom path + active folder badges
  const screenshotNewSession = join(ROOT, 'test-mobile-new-session.png')
  const nsArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=500,915',
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    '--user-data-dir=' + profileDir + '-ns',
    '--virtual-time-budget=5000',
    '--screenshot=' + screenshotNewSession,
    `http://localhost:${PORT}/test-new-session`,
  ]
  await new Promise((resolve) => {
    const p = spawn(chrome, nsArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    p.on('exit', () => resolve())
    setTimeout(() => { try { p.kill() } catch {} ; resolve() }, 15000)
  })
  log('New session modal screenshot:', existsSync(screenshotNewSession) ? 'YES' : 'NO', screenshotNewSession)
  try { rmSync(profileDir + '-ns', { recursive: true, force: true }) } catch {}

  // Xterm runtime check via iframe probe
  log('\n-- Xterm runtime check (spinner should collapse) --')
  const xtermProbeArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=600,1200',
    '--user-data-dir=' + profileDir + '-xterm',
    '--virtual-time-budget=8000',
    '--dump-dom',
    `http://localhost:${PORT}/test-terminal-probe`,
  ]
  const xtermDom = await new Promise((resolve) => {
    const p = spawn(chrome, xtermProbeArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('exit', () => resolve(out))
    setTimeout(() => { try { p.kill() } catch {} ; resolve(out) }, 20000)
  })
  const xtermOutMatch = xtermDom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  if (xtermOutMatch) {
    const raw = xtermOutMatch[1].trim()
    try {
      const r = JSON.parse(raw)
      log('opened:         ', r.opened)
      log('hasXterm:       ', r.hasXterm)
      log('error:          ', r.error || 'none')
      log('visible lines:  ', r.lineCount)
      log('spinner count:  ', r.spinnerCount, '(should be 1 if emulator works)')
      log('sample lines:')
      r.lines.forEach((l, i) => log('  ' + i + ':', l))
      if (!r.opened) fail++
      if (!r.hasXterm) fail++
      if (r.spinnerCount > 1) {
        log('FAIL: spinner did not collapse — still ' + r.spinnerCount + ' frames visible')
        fail++
      } else if (r.spinnerCount === 1) {
        log('PASS: spinner collapsed to 1 line')
      }
    } catch (e) {
      log('Could not parse xterm probe result:', e.message)
      log('Raw (500):', raw.substring(0, 500))
      fail++
    }
  } else {
    log('Could not find xterm probe output')
  }
  try { rmSync(profileDir + '-xterm', { recursive: true, force: true }) } catch {}

  // Width probe: find horizontal overflow
  log('\n-- Element width probe --')
  const widthArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=600,1200',
    '--user-data-dir=' + profileDir + '-widths',
    '--virtual-time-budget=8000',
    '--dump-dom',
    `http://localhost:${PORT}/test-widths`,
  ]
  const widthDom = await new Promise((resolve) => {
    const p = spawn(chrome, widthArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('exit', () => resolve(out))
    setTimeout(() => { try { p.kill() } catch {} ; resolve(out) }, 20000)
  })
  const widthOutMatch = widthDom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  if (widthOutMatch) {
    const raw = widthOutMatch[1].trim()
    log(raw)
    try {
      const r = JSON.parse(raw)
      const viewport = r.__viewport.innerWidth
      log('\nOverflow check (viewport=' + viewport + '):')
      Object.keys(r).forEach((id) => {
        if (id.startsWith('__')) return
        const el = r[id]
        if (el.right > viewport + 1 || el.scrollWidth > el.width + 1) {
          log('  OVERFLOW:', id, '  width=' + el.width, 'right=' + el.right, 'scrollWidth=' + el.scrollWidth)
        }
      })
    } catch {}
  }
  try { rmSync(profileDir + '-widths', { recursive: true, force: true }) } catch {}

  // Quick action click probe
  log('\n-- Quick action click → socket.emit check --')
  const clickArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=600,1200',
    '--user-data-dir=' + profileDir + '-clicks',
    '--virtual-time-budget=8000',
    '--dump-dom',
    `http://localhost:${PORT}/test-clicks`,
  ]
  const clickDom = await new Promise((resolve) => {
    const p = spawn(chrome, clickArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('exit', () => resolve(out))
    setTimeout(() => { try { p.kill() } catch {} ; resolve(out) }, 20000)
  })
  const clickOutMatch = clickDom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  if (clickOutMatch) {
    const raw = clickOutMatch[1].trim()
    try {
      const r = JSON.parse(raw)
      log('emissions captured:', r.count)
      let clickPass = 0, clickFail = 0
      r.items.forEach((item, i) => {
        if (item.event === 'session:input' && item.endsWithCR) {
          clickPass++
          log(`PASS: btn ${i} (${item.length} chars) → session:input "${item.preview}..."`)
        } else {
          clickFail++
          log(`FAIL: btn ${i} → event=${item.event} endsWithCR=${item.endsWithCR}`)
        }
      })
      log(`Clicks: ${clickPass}/${clickPass + clickFail}`)
      if (clickFail > 0 || r.count !== 17) fail += (clickFail || 1)
    } catch (e) {
      log('Could not parse click probe result:', e.message)
      log('Raw (500):', raw.substring(0, 500))
    }
  }
  try { rmSync(profileDir + '-clicks', { recursive: true, force: true }) } catch {}

  // Font size + help modal runtime check
  log('\n-- Font size control + help modal check --')
  const fontHelpArgs = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=600,1200',
    '--user-data-dir=' + profileDir + '-fonthelp',
    '--virtual-time-budget=8000',
    '--dump-dom',
    `http://localhost:${PORT}/test-font-help`,
  ]
  const fontHelpDom = await new Promise((resolve) => {
    const p = spawn(chrome, fontHelpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('exit', () => resolve(out))
    setTimeout(() => { try { p.kill() } catch {} ; resolve(out) }, 20000)
  })
  const fontHelpMatch = fontHelpDom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  if (fontHelpMatch) {
    const raw = fontHelpMatch[1].trim()
    try {
      const r = JSON.parse(raw)
      log('initialFont:         ', r.initialFont, '(expected 12)')
      log('after A+ twice:      ', r.afterIncTwice, '(expected 14)')
      log('after A- once:       ', r.afterDecOnce, '(expected 13)')
      log('stored in localStorage:', r.storedValue, '(expected 14)')
      log('help initially hidden:', r.helpInitiallyHidden)
      log('help opens on ? click:', r.helpOpensOnClick)
      log('help closes on Close:', r.helpClosesOnClick)

      const checks = [
        { name: 'initial font == 12',          ok: r.initialFont === 12 },
        { name: 'A+ twice → font 14',          ok: r.afterIncTwice === 14 },
        { name: 'A- once → font 13',           ok: r.afterDecOnce === 13 },
        { name: 'localStorage persisted 14',   ok: r.storedValue === '14' },
        { name: 'help modal initially hidden', ok: r.helpInitiallyHidden === true },
        { name: 'help modal opens on click',   ok: r.helpOpensOnClick === true },
        { name: 'help modal closes on Close',  ok: r.helpClosesOnClick === true },
      ]
      let fhPass = 0, fhFail = 0
      checks.forEach(c => {
        if (c.ok) { fhPass++; log('PASS:', c.name) }
        else { fhFail++; log('FAIL:', c.name) }
      })
      log(`Font+Help: ${fhPass}/${fhPass + fhFail}`)
      if (fhFail > 0) fail += fhFail
    } catch (e) {
      log('Could not parse font/help probe:', e.message)
      log('Raw (500):', raw.substring(0, 500))
    }
  }
  try { rmSync(profileDir + '-fonthelp', { recursive: true, force: true }) } catch {}

  // Cleanup
  try { rmSync(profileDir, { recursive: true, force: true }) } catch {}
  try { rmSync(profileDir + '-dom', { recursive: true, force: true }) } catch {}

  server.close()
  process.exit(fail > 0 ? 1 : 0)
}

server.listen(PORT, () => {
  log('Test server listening on', PORT)
  runTest().catch((e) => {
    log('ERROR:', e.message)
    server.close()
    process.exit(1)
  })
})
