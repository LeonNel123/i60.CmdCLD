# Remote Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the desktop React renderer at `/desktop` on the remote server so a laptop or tablet browser gets the same grid, focus, minimize, sidebar and drag/resize as the Electron app, while phones keep the existing remote UI.

**Architecture:** The existing React renderer is built a second time as a browser bundle (`remote.html` entry). A transport adapter (`remote-api.ts`) implements the preload bridge's `window.api` shape over Socket.IO and REST, with stubs for desktop-only calls. The remote server gains a few routes so the adapter can mirror the IPC handlers, and a tiny page-select rule redirects between `/` (phone UI) and `/desktop/` by viewport width.

**Tech Stack:** Electron 42, electron-vite 5 (Vite 7), React 18, xterm 5, Express, Socket.IO, vitest 4. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-remote-desktop-layout-design.md`

## Global Constraints

- No new npm dependencies. Socket.IO's client script is already served by the server at `/socket.io/socket.io.js`; the React bundle uses the global `io` it defines.
- `src/remote-ui/` stays plain, no-build JavaScript. New shared logic for it uses the IIFE + CommonJS dual-export pattern of `input-sanitizer.js`.
- Phone flow (`/`, `<769px`) must behave exactly as before. The threshold is **769 px** (matches `isMobile()` in `terminal-view.js`).
- PTY size ownership stays "last fit wins" (server relay unchanged).
- Remote must never write the desktop's `last-session.json`.
- No route may launch arbitrary programs on the host (no open-path / open-external / open-in-editor routes).
- All new routes sit behind the existing Host/Origin gate (it is registered before every route, so this is automatic; the tests confirm it).
- Run `npm test` after every task. Run `npx tsc --noEmit -p tsconfig.web.json` after any renderer change.
- Line endings: the repo may warn `LF will be replaced by CRLF` on Windows; expected.

**Deviation from spec (image paste):** the spec mapped `clipboardSaveImage` to the upload route. On the desktop that call reads the OS clipboard in main; a browser cannot read the clipboard on demand over plain http, and `TerminalPanel`'s paste path does not hand the pasted file to the API. So `clipboardSaveImage` resolves `null` on the browser page (text paste still works; image upload remains available in the phone UI). Wiring the paste event's file through to the upload route is a follow-on.

**Deviation from spec (dev mode):** the spec said the server proxies `/desktop` to the electron-vite dev server in dev. A proxy needs websocket passthrough for HMR and a dependency. Instead, the server serves `out/renderer` in both dev and prod and returns a clear 503 when the bundle has not been built. Dev workflow: `npm run build` once, then `npm run dev`.

## Review Focus

1. **Insecure browser context** (plain HTTP from a LAN or Tailscale IP): `crypto.randomUUID` is undefined there and `App.tsx` calls it for every new tile. Pinned in Task 6 (`uuid-polyfill` test). `navigator.clipboard` is also missing; `copyText` must fall back without throwing — pinned in Task 6.
2. **Create with an id already in use** (reload while a spawn is in flight): server must answer 409 and the adapter must reject so the tile's close-on-failure path runs. Pinned in Task 1 and Task 4.
3. **Non-UUID or empty client id**: 400, nothing spawned. Pinned in Task 1.
4. **Settings key outside `AppSettings`**: 400, nothing written. Pinned in Task 2.
5. **Session exit while several tiles are open**: only that id's exit subscriber fires, and unsubscribed tiles get nothing. Pinned in Task 4.
6. **Query flag vs stored preference**: `?mobile` / `?desktop` must beat the stored choice and overwrite it. Pinned in Task 8.

---

## File map

| File | Responsibility |
|---|---|
| `src/main/remote-server.ts` (modify) | Create route accepts client id/size/launchArgs and skips the launch write; new settings / recent / check / git routes; extended status; serves `/desktop`. |
| `tests/remote-server-desktop.test.ts` (create) | Route tests over real HTTP with fake deps. |
| `src/renderer/src/remote/fetch-json.ts` (create) | `fetchJson<T>()` — JSON fetch that throws the server's `error` message on non-2xx. |
| `src/renderer/src/remote/remote-api.ts` (create) | `createRemoteApi(deps)` — the `window.api` implementation: socket fan-out, terminal mapping, settings/recents/status mapping, stubs. |
| `tests/remote-api.test.ts` (create) | Fan-out, mapping and stub-table tests with a fake socket and fake fetch. |
| `src/renderer/src/remote/uuid-polyfill.ts` (create) | `installRandomUuidPolyfill(cryptoObj)`. |
| `src/renderer/src/remote/copy-text.ts` (create) | `copyText(text)` — clipboard with hidden-textarea fallback. |
| `src/renderer/src/remote/path-prompt.ts` (create) | `promptForPath()` — in-page path prompt returning `Promise<string|null>`. |
| `tests/remote-bootstrap-helpers.test.ts` (create) | Polyfill and copyText tests. |
| `src/renderer/remote.html` (create) | Second Vite entry; same head as `index.html` plus socket.io script. |
| `src/renderer/src/remote-main.tsx` (create) | Bootstrap: polyfill, fetch status, open socket, install api, dynamic-import App, mount. |
| `electron.vite.config.ts` (modify) | Renderer multi-entry input. |
| `tests/remote-desktop-page.test.ts` (create) | `remote.html` style block equals `index.html`'s; script tags present. |
| `src/renderer/src/types/api.d.ts` (modify) | `remote?: boolean` on `ElectronAPI`. |
| `src/renderer/src/components/Sidebar.tsx`, `TerminalPanel.tsx`, `App.tsx` (modify) | Hide desktop-only controls when `window.api.remote`. |
| `src/remote-ui/page-select.js` (create) | `choosePage()` pure rule, dual export. |
| `tests/remote-page-select.test.ts` (create) | Rule tests. |
| `src/remote-ui/index.html`, `src/renderer/remote.html` (modify) | Early redirect script. |
| `CLAUDE.md` (modify) | "Remote desktop page" section. |

---

### Task 1: Create route accepts a renderer-chosen id and does not launch

**Files:**
- Modify: `src/main/remote-server.ts` (`POST /api/sessions`, ~line 234)
- Test: `tests/remote-server-desktop.test.ts`

**Interfaces:**
- Consumes: `resolvePtySpawnSize` from `src/main/pty-create-validation.ts`; `PtyManager.create(id, cwd, wc, meta, spawnOverride?, size?)`.
- Produces: `export function isClientTerminalId(v: unknown): v is string` (UUID check). Request body shape `{ path, agentCli?, launchArgs?, id?, size?: {cols, rows} }`. Responses: 400 `{ error: 'id must be a UUID' }`, 409 `{ error: 'Terminal "<id>" already exists.' }`, 200 `{ id, name, path }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/remote-server-desktop.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import http from 'http'
import { tmpdir } from 'os'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RemoteServer } from '../src/main/remote-server'

type Created = { id: string; cwd: string; meta: any; size: any }

function fakeDeps(opts: { existingIds?: string[]; settings?: Record<string, unknown>; desktopUiPath?: string } = {}) {
  const created: Created[] = []
  const written: Array<{ id: string; data: string }> = []
  const existing = new Set(opts.existingIds ?? [])
  const values: Record<string, unknown> = {
    remoteLanAccess: false,
    claudeArgs: '', codexArgs: '', grokArgs: '', opencodeArgs: '',
    defaultAgentCli: 'claude',
    favoriteFolders: [],
    ...(opts.settings ?? {}),
  }
  const setCalls: Array<{ key: string; value: unknown }> = []
  const recentAdds: string[] = []
  const deps = {
    ptyManager: {
      on() {}, off() {},
      listAll() { return [] },
      has(id: string) { return existing.has(id) },
      getMeta(id: string) { return existing.has(id) ? { id } : undefined },
      create(id: string, cwd: string, _wc: unknown, meta: any, _o: unknown, size: any) {
        created.push({ id, cwd, meta, size }); existing.add(id)
      },
      write(id: string, data: string) { written.push({ id, data }) },
      getSize() { return { cols: 80, rows: 24 } },
      getScrollback() { return '' },
      kill() {},
    } as any,
    settings: {
      get: (k: string) => values[k],
      getAll: () => ({ ...values }),
      set: (key: string, value: unknown) => { setCalls.push({ key, value }); values[key] = value },
    } as any,
    recentDB: {
      list: async () => [],
      add: async (p: string) => { recentAdds.push(p) },
      remove: async () => {},
      checkPath: async (p: string) => (p === '/nope' ? 'missing' : 'ok'),
    } as any,
    getWebContents: () => ({ isDestroyed: () => false, send() {} }) as any,
    desktopUiPath: opts.desktopUiPath,
  }
  return { deps, created, written, setCalls, recentAdds }
}

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: {
          Host: `localhost:${port}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          let json: any = null
          try { json = JSON.parse(raw) } catch { json = raw }
          resolve({ status: res.statusCode ?? 0, json })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const VALID_ID = '3b241101-e2bb-4255-8caf-4136c566a962'

describe('POST /api/sessions with a renderer-chosen id', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  async function start(opts: Parameters<typeof fakeDeps>[0] = {}) {
    const f = fakeDeps(opts)
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    return { port, ...f }
  }

  it('spawns under the given id at the given size and does not write a launch command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created, written } = await start()
    const res = await request(port, 'POST', '/api/sessions', {
      id: VALID_ID, path: dir, agentCli: 'claude', launchArgs: '--foo', size: { cols: 120, rows: 40 },
    })
    expect(res.status).toBe(200)
    expect(res.json.id).toBe(VALID_ID)
    expect(created).toHaveLength(1)
    expect(created[0].id).toBe(VALID_ID)
    expect(created[0].size).toEqual({ cols: 120, rows: 40 })
    expect(created[0].meta.launchArgs).toBe('--foo')
    // The renderer writes the launch command itself after create resolves.
    await new Promise((r) => setTimeout(r, 1100))
    expect(written).toHaveLength(0)
  })

  it('still launches server-side when no id is supplied (phone flow unchanged)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created, written } = await start()
    const res = await request(port, 'POST', '/api/sessions', { path: dir, agentCli: 'claude' })
    expect(res.status).toBe(200)
    expect(created).toHaveLength(1)
    expect(created[0].id).not.toBe(VALID_ID)
    await new Promise((r) => setTimeout(r, 1100))
    expect(written).toHaveLength(1)
    expect(written[0].id).toBe(created[0].id)
  })

  it('rejects a non-UUID id with 400 and spawns nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start()
    const res = await request(port, 'POST', '/api/sessions', { id: 'not-a-uuid', path: dir })
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('id must be a UUID')
    expect(created).toHaveLength(0)
  })

  it('rejects an id already in use with 409 and spawns nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start({ existingIds: [VALID_ID] })
    const res = await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir })
    expect(res.status).toBe(409)
    expect(res.json.error).toBe(`Terminal "${VALID_ID}" already exists.`)
    expect(created).toHaveLength(0)
  })

  it('falls back to the default spawn size when size is garbage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, created } = await start()
    await request(port, 'POST', '/api/sessions', { id: VALID_ID, path: dir, size: { cols: -1, rows: 'x' } })
    expect(created[0].size).toEqual({ cols: 80, rows: 24 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/remote-server-desktop.test.ts`
Expected: FAIL. The first test fails on `created[0].id` (server mints its own id) and `written` has one entry; the 400/409 tests get 200.

- [ ] **Step 3: Implement the route change**

In `src/main/remote-server.ts`:

Add imports near the top:

```ts
import { resolvePtySpawnSize } from './pty-create-validation'
```

Add after `normalizeSubmitText`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A terminal id the browser renderer chose for itself (crypto.randomUUID). */
export function isClientTerminalId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
```

Replace the body of `app.post('/api/sessions', ...)` from the destructuring line through the `res.json({ id, name, path: cwd })` with:

```ts
      const {
        path: cwd, agentCli: agentCliRaw, claudeArgs, codexArgs, grokArgs, opencodeArgs,
        id: clientId, size: sizeRaw, launchArgs: launchArgsRaw,
      } = req.body
      if (!cwd || typeof cwd !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      try {
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          res.status(400).json({ error: 'Invalid directory path' })
          return
        }
      } catch {
        res.status(400).json({ error: 'Invalid directory path' })
        return
      }

      // Renderer-driven create: the /desktop React page chose the id and will
      // write the launch command itself once this resolves (same contract as
      // pty:create). The phone UI sends no id and relies on the server to launch.
      const rendererDriven = clientId !== undefined
      if (rendererDriven) {
        if (!isClientTerminalId(clientId)) {
          res.status(400).json({ error: 'id must be a UUID' })
          return
        }
        if (this.ptyManager.has(clientId)) {
          res.status(409).json({ error: `Terminal "${clientId}" already exists.` })
          return
        }
      }

      const id = rendererDriven ? clientId : crypto.randomUUID()
      const name = cwd.split(/[\\/]/).pop() || cwd
      const agentCli = normalizeAgentCli(agentCliRaw)
      const argsByAgent: Record<AgentCli, string> = {
        claude: typeof claudeArgs === 'string' ? claudeArgs : this.settings.get('claudeArgs'),
        codex: typeof codexArgs === 'string' ? codexArgs : this.settings.get('codexArgs'),
        grok: typeof grokArgs === 'string' ? grokArgs : this.settings.get('grokArgs'),
        opencode: typeof opencodeArgs === 'string' ? opencodeArgs : this.settings.get('opencodeArgs'),
      }
      const args = rendererDriven && typeof launchArgsRaw === 'string'
        ? launchArgsRaw
        : getArgsForAgent(agentCli, {
            claudeArgs: argsByAgent.claude,
            codexArgs: argsByAgent.codex,
            grokArgs: argsByAgent.grok,
            opencodeArgs: argsByAgent.opencode,
          })
      const meta: TerminalMeta = { id, path: cwd, name, color: '', agentCli, launchArgs: args }
      const wc = this.getWebContents()

      if (!wc) {
        res.status(500).json({ error: 'No active window' })
        return
      }

      if (agentCli === 'claude') trustFolder(cwd)
      const size = resolvePtySpawnSize(rendererDriven ? sizeRaw : undefined)
      try {
        this.ptyManager.create(id, cwd, wc, meta, undefined, size)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        res.status(500).json({ error: `PTY spawn failed: ${msg}` })
        return
      }

      this.recentDB.add(cwd).catch(() => {})

      if (!rendererDriven) {
        const launchCmd = buildAgentLaunchCommand(agentCli, args)
        setTimeout(() => {
          this.ptyManager.write(id, launchCmd)
        }, 1000)
      }

      // Notify the desktop renderer so it adds a tile under this same id. Its
      // TerminalPanel sees pty:exists → replays scrollback → launches nothing.
      try {
        if (!wc.isDestroyed()) {
          wc.send('remote:session-created', {
            id, path: cwd, name, color: '', agentCli,
            claudeArgs: argsByAgent.claude,
            codexArgs: argsByAgent.codex,
            grokArgs: argsByAgent.grok,
            opencodeArgs: argsByAgent.opencode,
          })
        }
      } catch {}

      res.json({ id, name, path: cwd })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/remote-server-desktop.test.ts tests/remote-server.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/remote-server.ts tests/remote-server-desktop.test.ts
git commit -m "feat(remote): create route accepts a renderer-chosen id and skips the launch write"
```

---

### Task 2: Status, settings, recent, check and git routes

**Files:**
- Modify: `src/main/remote-server.ts` (`setupRestApi`)
- Test: `tests/remote-server-desktop.test.ts` (append)

**Interfaces:**
- Consumes: `getGitStatus(path)`, `clearGitStatusCache(path)` from `src/main/git-status.ts`; `RecentDB.checkPath(p)`; `Settings.getAll()/set()`.
- Produces:
  - `GET /api/status` → `{ version, uptime, sessions, platform, homeDir, buildInfo: { electron, chrome, node, platform, release } }`
  - `GET /api/settings` → full `AppSettings` plus `cliAvailability`
  - `POST /api/settings` body `{ key, value }` → `{ ok: true }` | 400 `{ error: 'unknown setting' }`
  - `POST /api/folders/recent` body `{ path }` → `{ ok: true }` | 400
  - `GET /api/folders/check?path=` → `{ status: 'ok' | 'missing' | 'unmounted' }`
  - `GET /api/git/status?path=&fresh=1` → `GitStatus`

- [ ] **Step 1: Write the failing tests**

Append to `tests/remote-server-desktop.test.ts` (inside the file, after the first `describe`):

```ts
describe('desktop-page support routes', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  async function start(opts: Parameters<typeof fakeDeps>[0] = {}) {
    const f = fakeDeps(opts)
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    return { port, ...f }
  }

  it('GET /api/status carries platform, home dir and build info', async () => {
    const { port } = await start()
    const res = await request(port, 'GET', '/api/status')
    expect(res.status).toBe(200)
    expect(['win32', 'darwin', 'linux']).toContain(res.json.platform)
    expect(typeof res.json.homeDir).toBe('string')
    expect(res.json.homeDir.length).toBeGreaterThan(0)
    expect(res.json.buildInfo).toMatchObject({ node: process.versions.node, platform: process.platform })
  })

  it('GET /api/settings returns every setting plus cliAvailability', async () => {
    const { port } = await start({ settings: { defaultViewMode: 'focused', terminalFontSize: 13 } })
    const res = await request(port, 'GET', '/api/settings')
    expect(res.status).toBe(200)
    expect(res.json.defaultViewMode).toBe('focused')
    expect(res.json.terminalFontSize).toBe(13)
    expect(res.json.favoriteFolders).toEqual([])
    expect(res.json.cliAvailability).toBeTypeOf('object')
  })

  it('POST /api/settings writes a known key and rejects an unknown one', async () => {
    const { port, setCalls } = await start()
    const ok = await request(port, 'POST', '/api/settings', { key: 'defaultViewMode', value: 'focused' })
    expect(ok.status).toBe(200)
    expect(setCalls).toEqual([{ key: 'defaultViewMode', value: 'focused' }])
    const bad = await request(port, 'POST', '/api/settings', { key: '__proto__', value: 1 })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('unknown setting')
    expect(setCalls).toHaveLength(1)
  })

  it('POST /api/folders/recent adds an existing directory and rejects a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port, recentAdds } = await start()
    const ok = await request(port, 'POST', '/api/folders/recent', { path: dir })
    expect(ok.status).toBe(200)
    expect(recentAdds).toEqual([dir])
    const bad = await request(port, 'POST', '/api/folders/recent', { path: join(dir, 'nope') })
    expect(bad.status).toBe(400)
    expect(recentAdds).toHaveLength(1)
  })

  it('GET /api/folders/check relays recentDB.checkPath', async () => {
    const { port } = await start()
    const ok = await request(port, 'GET', '/api/folders/check?path=' + encodeURIComponent('/tmp'))
    expect(ok.json).toEqual({ status: 'ok' })
    const missing = await request(port, 'GET', '/api/folders/check?path=' + encodeURIComponent('/nope'))
    expect(missing.json).toEqual({ status: 'missing' })
    const none = await request(port, 'GET', '/api/folders/check')
    expect(none.status).toBe(400)
  })

  it('GET /api/git/status reports a non-repo directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-'))
    const { port } = await start()
    const res = await request(port, 'GET', '/api/git/status?path=' + encodeURIComponent(dir))
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ isRepo: false, branch: null, dirty: false, ahead: 0 })
    const none = await request(port, 'GET', '/api/git/status')
    expect(none.json).toMatchObject({ isRepo: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/remote-server-desktop.test.ts`
Expected: the new describe fails (missing fields, 404s).

- [ ] **Step 3: Implement the routes**

In `src/main/remote-server.ts`:

Imports:

```ts
import { networkInterfaces, homedir, release } from 'os'
import { getGitStatus, clearGitStatusCache } from './git-status'
```

(Replace the existing `import { networkInterfaces } from 'os'`.)

Replace the `/api/status` handler:

```ts
    app.get('/api/status', (_req: any, res: any) => {
      let version = 'unknown'
      try { version = require('../../package.json').version } catch {}
      res.json({
        version,
        uptime: Date.now() - this.startTime,
        sessions: this.ptyManager.listAll().length,
        platform: process.platform,
        homeDir: homedir(),
        buildInfo: {
          electron: process.versions.electron ?? '',
          chrome: process.versions.chrome ?? '',
          node: process.versions.node,
          platform: process.platform,
          release: release(),
        },
      })
    })
```

Replace the `/api/settings` GET handler and add POST:

```ts
    app.get('/api/settings', (_req: any, res: any) => {
      res.json({ ...this.settings.getAll(), cliAvailability: detectAgentCliAvailability() })
    })

    // Mirrors ipc 'settings:set'. Key must be one the settings store already
    // knows — this is what stops a remote page planting arbitrary fields.
    app.post('/api/settings', (req: any, res: any) => {
      const { key, value } = req.body ?? {}
      const known = Object.keys(this.settings.getAll())
      if (typeof key !== 'string' || !known.includes(key)) {
        res.status(400).json({ error: 'unknown setting' })
        return
      }
      this.settings.set(key as any, value as any)
      res.json({ ok: true })
    })
```

Add after the `DELETE /api/folders/recent` handler:

```ts
    app.post('/api/folders/recent', async (req: any, res: any) => {
      const { path: folderPath } = req.body ?? {}
      if (!folderPath || typeof folderPath !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      try {
        if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
          res.status(400).json({ error: 'Invalid directory path' })
          return
        }
        await this.recentDB.add(folderPath)
        res.json({ ok: true })
      } catch {
        res.status(500).json({ error: 'failed to add' })
      }
    })

    app.get('/api/folders/check', async (req: any, res: any) => {
      const p = req.query?.path
      if (typeof p !== 'string' || !p) {
        res.status(400).json({ error: 'path is required' })
        return
      }
      const status = await Promise.resolve(this.recentDB.checkPath(p))
      res.json({ status })
    })

    app.get('/api/git/status', async (req: any, res: any) => {
      const p = req.query?.path
      if (typeof p !== 'string' || !p) {
        res.json({ isRepo: false, branch: null, dirty: false, ahead: 0 })
        return
      }
      if (req.query?.fresh === '1') clearGitStatusCache(p)
      res.json(await getGitStatus(p))
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/remote-server-desktop.test.ts tests/remote-server.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/remote-server.ts tests/remote-server-desktop.test.ts
git commit -m "feat(remote): status, settings, recent, check and git routes for the desktop page"
```

---

### Task 3: Serve `/desktop` from the renderer bundle

**Files:**
- Modify: `src/main/remote-server.ts` (constructor opts, `setupStaticFiles`)
- Test: `tests/remote-server-desktop.test.ts` (append)

**Interfaces:**
- Produces: constructor option `desktopUiPath?: string` (default `join(__dirname, '../renderer')`). `GET /desktop/` serves `remote.html`; when the bundle is absent every `/desktop*` path returns 503 text.

- [ ] **Step 1: Write the failing tests**

Append to `tests/remote-server-desktop.test.ts`:

```ts
describe('/desktop page serving', () => {
  let servers: RemoteServer[] = []
  afterEach(() => { for (const s of servers) s.stop(); servers = [] })

  it('serves remote.html and its assets from the configured bundle dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-ui-'))
    writeFileSync(join(dir, 'remote.html'), '<!doctype html><title>R</title>')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'a.js'), 'console.log(1)')
    const f = fakeDeps({ desktopUiPath: dir })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const page = await request(port, 'GET', '/desktop/')
    expect(page.status).toBe(200)
    expect(String(page.json)).toContain('<title>R</title>')
    const asset = await request(port, 'GET', '/desktop/assets/a.js')
    expect(asset.status).toBe(200)
  })

  it('answers 503 with a build hint when the bundle is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdcld-empty-'))
    const f = fakeDeps({ desktopUiPath: dir })
    const server = new RemoteServer(f.deps)
    servers.push(server)
    const { port } = await server.start(0)
    const page = await request(port, 'GET', '/desktop/')
    expect(page.status).toBe(503)
    expect(String(page.json)).toContain('npm run build')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/remote-server-desktop.test.ts`
Expected: FAIL with 404 on `/desktop/`.

- [ ] **Step 3: Implement**

In `src/main/remote-server.ts`:

Add a field and constructor option:

```ts
  private desktopUiPath: string

  constructor(opts: {
    ptyManager: PtyManager
    settings: Settings
    recentDB: RecentDB
    getWebContents: () => Electron.WebContents | null
    /** Where the browser build of the React renderer lives (out/renderer). */
    desktopUiPath?: string
  }) {
    // ...existing assignments...
    this.desktopUiPath = opts.desktopUiPath ?? join(__dirname, '../renderer')
  }
```

At the end of `setupStaticFiles()`, before the `this.app.get('/', ...)` route, add:

```ts
    // The desktop layout page: the React renderer built for the browser.
    // Served in dev and prod from out/renderer; dev needs `npm run build` once.
    if (existsSync(join(this.desktopUiPath, 'remote.html'))) {
      this.app.use('/desktop', express.static(this.desktopUiPath, { index: 'remote.html' }))
    } else {
      this.app.use('/desktop', (_req: any, res: any) => {
        res.status(503).type('text/plain').send(
          'Remote desktop page is not built. Run `npm run build`, then restart remote access.',
        )
      })
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/remote-server-desktop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/remote-server.ts tests/remote-server-desktop.test.ts
git commit -m "feat(remote): serve the desktop layout page at /desktop"
```

---

### Task 4: Transport adapter — socket fan-out and terminal calls

**Files:**
- Create: `src/renderer/src/remote/fetch-json.ts`
- Create: `src/renderer/src/remote/remote-api.ts`
- Test: `tests/remote-api.test.ts`

**Interfaces:**
- Produces:

```ts
// fetch-json.ts
export type FetchJson = <T>(path: string, init?: RequestInit) => Promise<T>
export const fetchJson: FetchJson

// remote-api.ts
export interface SocketLike {
  connected: boolean
  on(event: string, cb: (...args: any[]) => void): void
  off(event: string, cb: (...args: any[]) => void): void
  emit(event: string, payload: unknown): void
}
export interface RemoteStatus {
  platform: 'win32' | 'darwin' | 'linux'
  homeDir: string
  version: string
  buildInfo: { electron: string; chrome: string; node: string; platform: string; release: string }
}
export interface RemoteApiDeps {
  socket: SocketLike
  fetchJson: FetchJson
  status: RemoteStatus
  promptForPath: () => Promise<string | null>
  copyText: (text: string) => boolean
}
export function createRemoteApi(deps: RemoteApiDeps): ElectronAPI & { remote: true }
```

- [ ] **Step 1: Write the failing tests**

Create `tests/remote-api.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRemoteApi, type SocketLike, type RemoteStatus } from '../src/renderer/src/remote/remote-api'

class FakeSocket implements SocketLike {
  connected = true
  handlers = new Map<string, Array<(...a: any[]) => void>>()
  emitted: Array<{ event: string; payload: unknown }> = []
  on(event: string, cb: (...a: any[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb])
  }
  off(event: string, cb: (...a: any[]) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb))
  }
  emit(event: string, payload: unknown) { this.emitted.push({ event, payload }) }
  // Test helper: simulate a server→client event.
  receive(event: string, payload: unknown) { for (const h of this.handlers.get(event) ?? []) h(payload) }
}

const status: RemoteStatus = {
  platform: 'darwin', homeDir: '/Users/me', version: '1.6.37',
  buildInfo: { electron: '42', chrome: '1', node: '24', platform: 'darwin', release: '25' },
}

function make(fetchImpl?: (path: string, init?: RequestInit) => Promise<unknown>) {
  const socket = new FakeSocket()
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init })
    return (fetchImpl ? await fetchImpl(path, init) : {}) as T
  }
  const api = createRemoteApi({
    socket, fetchJson, status,
    promptForPath: async () => '/picked',
    copyText: () => true,
  })
  return { api, socket, calls }
}

describe('createRemoteApi — socket fan-out', () => {
  it('routes output only to the subscriber for that id', () => {
    const { api, socket } = make()
    const a: string[] = []; const b: string[] = []
    api.onTerminalData('a', (d) => a.push(d))
    api.onTerminalData('b', (d) => b.push(d))
    socket.receive('session:output', { id: 'a', data: 'hello' })
    expect(a).toEqual(['hello'])
    expect(b).toEqual([])
  })

  it('stops delivering after unsubscribe', () => {
    const { api, socket } = make()
    const seen: string[] = []
    const unsub = api.onTerminalData('a', (d) => seen.push(d))
    socket.receive('session:output', { id: 'a', data: '1' })
    unsub()
    socket.receive('session:output', { id: 'a', data: '2' })
    expect(seen).toEqual(['1'])
  })

  it('delivers exit codes and resizes per id', () => {
    const { api, socket } = make()
    const exits: number[] = []; const sizes: Array<{ cols: number; rows: number }> = []
    api.onTerminalExit('x', (c) => exits.push(c))
    api.onTerminalResize('x', (s) => sizes.push(s))
    api.onTerminalExit('y', () => exits.push(-1))
    socket.receive('session:exit', { id: 'x', exitCode: 3 })
    socket.receive('session:resize', { id: 'x', cols: 100, rows: 30 })
    expect(exits).toEqual([3])
    expect(sizes).toEqual([{ cols: 100, rows: 30 }])
  })
})

describe('createRemoteApi — terminal calls', () => {
  it('createTerminal posts id, path, agentCli, launchArgs and size', async () => {
    const { api, calls } = make(async () => ({ id: 'id1', name: 'p', path: '/p' }))
    await api.createTerminal('id1', '/p', 'codex', '--x', false, { cols: 90, rows: 20 })
    expect(calls[0].path).toBe('/api/sessions')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      id: 'id1', path: '/p', agentCli: 'codex', launchArgs: '--x', size: { cols: 90, rows: 20 },
    })
  })

  it('createTerminal rejects with the server message on failure', async () => {
    const { api } = make(async () => { throw new Error('Terminal "id1" already exists.') })
    await expect(api.createTerminal('id1', '/p')).rejects.toThrow('already exists')
  })

  it('writeTerminal and resizeTerminal emit socket events', async () => {
    const { api, socket } = make()
    await api.writeTerminal('t', 'ls\r')
    await api.resizeTerminal('t', 120, 40)
    expect(socket.emitted).toEqual([
      { event: 'session:input', payload: { id: 't', data: 'ls\r' } },
      { event: 'session:resize', payload: { id: 't', cols: 120, rows: 40 } },
    ])
  })

  it('killTerminal, getScrollback, terminalExists, terminalListLive map to REST', async () => {
    const sessions = [{ id: 't', path: '/p', name: 'p', color: '' }]
    const { api, calls } = make(async (path) => {
      if (path === '/api/sessions') return sessions
      if (path.endsWith('/scrollback')) return { scrollback: 'SB', cols: 80, rows: 24 }
      return { ok: true }
    })
    await api.killTerminal('t')
    expect(calls[0]).toMatchObject({ path: '/api/sessions/t', init: { method: 'DELETE' } })
    expect(await api.getScrollback('t')).toBe('SB')
    expect(await api.terminalExists('t')).toBe(true)
    expect(await api.terminalExists('zz')).toBe(false)
    expect(await api.terminalListLive()).toEqual(sessions)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/remote-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fetch-json.ts`**

```ts
// src/renderer/src/remote/fetch-json.ts
export type FetchJson = <T>(path: string, init?: RequestInit) => Promise<T>

/** JSON fetch against the remote server. Non-2xx rejects with the server's
 *  `error` field so callers surface the same message the IPC twin would. */
export const fetchJson: FetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`)
  return body as T
}
```

- [ ] **Step 4: Implement `remote-api.ts` (terminal part; the rest comes in Task 5)**

```ts
// src/renderer/src/remote/remote-api.ts
import type { ElectronAPI } from '../types/api'
import type { FetchJson } from './fetch-json'

export interface SocketLike {
  connected: boolean
  on(event: string, cb: (...args: any[]) => void): void
  off(event: string, cb: (...args: any[]) => void): void
  emit(event: string, payload: unknown): void
}

export interface RemoteStatus {
  platform: 'win32' | 'darwin' | 'linux'
  homeDir: string
  version: string
  buildInfo: { electron: string; chrome: string; node: string; platform: string; release: string }
}

export interface RemoteApiDeps {
  socket: SocketLike
  fetchJson: FetchJson
  status: RemoteStatus
  promptForPath: () => Promise<string | null>
  copyText: (text: string) => boolean
}

type Listener<T> = (payload: T) => void

/** Per-id subscriber registry for one server event. One socket listener is
 *  attached at construction; subscribers are looked up by id on each event. */
function fanOut<T extends { id: string }>(socket: SocketLike, event: string) {
  const subs = new Map<string, Set<Listener<T>>>()
  socket.on(event, (msg: T) => {
    if (!msg || typeof msg.id !== 'string') return
    const set = subs.get(msg.id)
    if (!set) return
    for (const cb of [...set]) cb(msg)
  })
  return (id: string, cb: Listener<T>): (() => void) => {
    let set = subs.get(id)
    if (!set) { set = new Set(); subs.set(id, set) }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) subs.delete(id)
    }
  }
}

export function createRemoteApi(deps: RemoteApiDeps): ElectronAPI & { remote: true } {
  const { socket, fetchJson, status } = deps
  const post = <T,>(path: string, body: unknown) =>
    fetchJson<T>(path, { method: 'POST', body: JSON.stringify(body) })

  const onOutput = fanOut<{ id: string; data: string }>(socket, 'session:output')
  const onExit = fanOut<{ id: string; exitCode: number }>(socket, 'session:exit')
  const onResize = fanOut<{ id: string; cols: number; rows: number }>(socket, 'session:resize')

  // Partial so every member is contextually typed (no implicit any on the
  // arrow parameters). Task 5 fills in the remaining members and drops Partial.
  const api: Partial<ElectronAPI> & { remote: true } = {
    remote: true,
    platform: status.platform,
    getPathForFile: () => '',

    // ---- terminal lifecycle --------------------------------------------
    createTerminal: async (id, cwd, agentCli, launchArgs, _elevated, size) => {
      await post('/api/sessions', { id, path: cwd, agentCli, launchArgs, size })
    },
    writeTerminal: async (id, data) => { socket.emit('session:input', { id, data }) },
    resizeTerminal: async (id, cols, rows) => { socket.emit('session:resize', { id, cols, rows }) },
    killTerminal: async (id) => { await fetchJson(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
    getScrollback: async (id) =>
      (await fetchJson<{ scrollback: string }>(`/api/sessions/${encodeURIComponent(id)}/scrollback`)).scrollback ?? '',
    terminalExists: async (id) =>
      (await fetchJson<Array<{ id: string }>>('/api/sessions')).some((s) => s.id === id),
    terminalListLive: () => fetchJson('/api/sessions'),
    onTerminalData: (id, cb) => onOutput(id, (m) => cb(m.data)),
    onTerminalExit: (id, cb) => onExit(id, (m) => cb(m.exitCode)),
    onTerminalResize: (id, cb) => onResize(id, (m) => cb({ cols: m.cols, rows: m.rows })),
  }

  return api as ElectronAPI & { remote: true }
}
```

(The trailing cast is temporary; Task 5 fills in every remaining key, types `api` as the full `ElectronAPI & { remote: true }`, and returns it without a cast.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/remote-api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/remote/fetch-json.ts src/renderer/src/remote/remote-api.ts tests/remote-api.test.ts
git commit -m "feat(remote): transport adapter with socket fan-out and terminal calls"
```

---

### Task 5: Transport adapter — settings, recents, status, clipboard, folder prompt, stubs

**Files:**
- Modify: `src/renderer/src/remote/remote-api.ts`
- Modify: `src/renderer/src/types/api.d.ts` (add `remote?: boolean`)
- Test: `tests/remote-api.test.ts` (append)

**Interfaces:**
- Consumes: routes from Task 2.
- Produces: the complete `ElectronAPI` object. `window.api.remote === true` on the browser page and `undefined` in Electron.

- [ ] **Step 1: Write the failing tests**

Append to `tests/remote-api.test.ts`:

```ts
describe('createRemoteApi — settings, recents, status', () => {
  it('settingsGetAll / settingsSet / recent* / gitStatus / getHomeDir map to REST', async () => {
    const { api, calls } = make(async (path) => {
      if (path === '/api/settings') return { defaultViewMode: 'grid', cliAvailability: {} }
      if (path === '/api/folders/recent') return [{ path: '/a', name: 'a', lastOpened: 1 }]
      if (path.startsWith('/api/folders/check')) return { status: 'missing' }
      if (path.startsWith('/api/git/status')) return { isRepo: true, branch: 'main', dirty: false, ahead: 0 }
      return { ok: true }
    })
    expect((await api.settingsGetAll()).defaultViewMode).toBe('grid')
    await api.settingsSet('defaultViewMode', 'focused')
    expect(calls.at(-1)).toMatchObject({ path: '/api/settings', init: { method: 'POST' } })
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ key: 'defaultViewMode', value: 'focused' })
    expect(await api.recentList()).toHaveLength(1)
    await api.recentAdd('/b')
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ path: '/b' })
    await api.recentRemove('/b')
    expect(calls.at(-1)).toMatchObject({ path: '/api/folders/recent', init: { method: 'DELETE' } })
    expect(await api.recentCheckPath('/zz')).toBe('missing')
    expect(calls.at(-1)!.path).toBe('/api/folders/check?path=%2Fzz')
    expect((await api.gitStatus('/r', true)).branch).toBe('main')
    expect(calls.at(-1)!.path).toBe('/api/git/status?path=%2Fr&fresh=1')
    expect(await api.getHomeDir()).toBe('/Users/me')
    expect(await api.getVersion()).toBe('1.6.37')
    expect((await api.getBuildInfo()).node).toBe('24')
    expect(await api.agentCliAvailability()).toEqual({})
  })

  it('session restore is read-empty / write-noop so the desktop file is never touched', async () => {
    const { api, calls } = make()
    expect(await api.sessionLoadLast()).toBeNull()
    await api.sessionSaveLast({ savedAt: 1, projects: [] })
    await api.sessionClearLast()
    expect(calls).toHaveLength(0)
  })

  it('selectFolder uses the injected prompt; clipboard uses injected copy and upload route', async () => {
    const { api, calls } = make(async () => ({ path: '/p/.screenshots/x.png' }))
    expect(await api.selectFolder()).toBe('/picked')
    await api.clipboardWriteText('hi')
    expect(await api.clipboardReadFiles()).toBeNull()
    expect(await api.clipboardSaveImage('/p')).toBeNull() // no image in a browser clipboard read; upload is paste-driven
    expect(calls).toHaveLength(0)
  })
})

describe('createRemoteApi — every ElectronAPI member exists and stubs resolve', () => {
  const PRELOAD_KEYS = [
    'platform','getPathForFile','createTerminal','writeTerminal','resizeTerminal','killTerminal','getScrollback',
    'terminalExists','terminalListLive','onTerminalData','onTerminalExit','onTerminalResize','selectFolder',
    'loadState','saveState','recentList','recentAdd','recentRemove','clipboardSaveImage','clipboardReadFiles',
    'clipboardWriteText','openPath','adminShellMode','openAdminShell','readFile','getHomeDir','getVersion',
    'projectCreate','openrouterModels','settingsGetAll','settingsSet','agentCliAvailability','settingsGetBudgetState',
    'settingsSetBudgetCap','settingsResetTodaySpend','windowCreate','windowList','onWindowCloseRequest',
    'windowConfirmClose','openExternal','openInExplorer','openInEditor','editorProbeProject','editorGetAvailable',
    'editorGetDefaults','editorSetDefault','onWindowListUpdated','recentCheckPath','claudeConfigRead',
    'claudeConfigWrite','sessionSaveLast','sessionLoadLast','sessionClearLast','gitStatus','getBuildInfo',
    'remoteToggle','remoteStatus','tailscaleStatus','tailscaleServeStart','tailscaleServeStop',
    'onRemoteSessionCreated','autopilotKeyExists','autopilotKeySet','autopilotKeyClear','autopilotStart',
    'autopilotProStart','autopilotCouncilStart','autopilotProRunMeta','autopilotPause','autopilotResume',
    'autopilotStop','autopilotApproveGoal','autopilotReplyToWaiting','autopilotPermissionAllow',
    'autopilotPermissionDeny','autopilotGetStatus','autopilotInspectOutput','autopilotProbeArtifacts',
    'autopilotAttachDraft','autopilotAttachConfirm','autopilotAttachStatus','autopilotAttachCancel',
    'broadcastRefine','broadcastSend','aiUsageSummary','terminalListExternal','terminalOpenExternal',
    'promptsList','promptsDelete','promptsClear','promptsCount','onAutopilotUpdate',
  ]
  const NETWORKED = new Set([
    'createTerminal','writeTerminal','resizeTerminal','killTerminal','getScrollback','terminalExists',
    'terminalListLive','recentList','recentAdd','recentRemove','recentCheckPath','settingsGetAll','settingsSet',
    'agentCliAvailability','gitStatus','clipboardSaveImage',
  ])

  it('defines every preload key', () => {
    const { api } = make()
    for (const k of PRELOAD_KEYS) expect(api, k).toHaveProperty(k)
    expect(api.remote).toBe(true)
  })

  it('every non-networked function resolves (or returns an unsubscribe) without throwing', async () => {
    const { api } = make()
    for (const k of PRELOAD_KEYS) {
      if (NETWORKED.has(k) || k === 'platform') continue
      const fn = (api as any)[k]
      expect(typeof fn, k).toBe('function')
      const out = fn(() => {})
      if (typeof out === 'function') { out(); continue }
      let settled = true
      try { await out } catch { settled = false }
      expect(settled, k).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/remote-api.test.ts`
Expected: the new describes fail on missing keys.

- [ ] **Step 3: Add `remote` to the API type**

In `src/renderer/src/types/api.d.ts`, inside `export interface ElectronAPI {`, add as the first member:

```ts
  /** True on the browser (/desktop) page, where window.api is the transport
   *  adapter. Absent in Electron. Components use it to hide desktop-only controls. */
  remote?: boolean
```

- [ ] **Step 4: Complete the adapter**

In `remote-api.ts`, replace everything from `const api = {` to the closing `return api` with:

```ts
  const noop = async () => {}
  const unsub = () => () => {}
  const q = (params: Record<string, string | undefined>) =>
    '?' + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

  const api: ElectronAPI & { remote: true } = {
    remote: true,
    platform: status.platform,
    getPathForFile: () => '',

    // ---- terminal lifecycle --------------------------------------------
    createTerminal: async (id, cwd, agentCli, launchArgs, _elevated, size) => {
      await post('/api/sessions', { id, path: cwd, agentCli, launchArgs, size })
    },
    writeTerminal: async (id, data) => { socket.emit('session:input', { id, data }) },
    resizeTerminal: async (id, cols, rows) => { socket.emit('session:resize', { id, cols, rows }) },
    killTerminal: async (id) => { await fetchJson(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
    getScrollback: async (id) =>
      (await fetchJson<{ scrollback: string }>(`/api/sessions/${encodeURIComponent(id)}/scrollback`)).scrollback ?? '',
    terminalExists: async (id) =>
      (await fetchJson<Array<{ id: string }>>('/api/sessions')).some((s) => s.id === id),
    terminalListLive: () => fetchJson('/api/sessions'),
    onTerminalData: (id, cb) => onOutput(id, (m) => cb(m.data)),
    onTerminalExit: (id, cb) => onExit(id, (m) => cb(m.exitCode)),
    onTerminalResize: (id, cb) => onResize(id, (m) => cb({ cols: m.cols, rows: m.rows })),

    // ---- folders / recents / settings ----------------------------------
    selectFolder: () => deps.promptForPath(),
    loadState: async () => null,
    saveState: noop,
    recentList: () => fetchJson('/api/folders/recent'),
    recentAdd: async (p) => { await post('/api/folders/recent', { path: p }) },
    recentRemove: async (p) => { await fetchJson('/api/folders/recent', { method: 'DELETE', body: JSON.stringify({ path: p }) }) },
    recentCheckPath: async (p) => (await fetchJson<{ status: 'ok' | 'missing' | 'unmounted' }>('/api/folders/check' + q({ path: p }))).status,
    settingsGetAll: () => fetchJson('/api/settings'),
    settingsSet: async (key, value) => { await post('/api/settings', { key, value }) },
    agentCliAvailability: async () =>
      (await fetchJson<{ cliAvailability: any }>('/api/settings')).cliAvailability ?? {},
    gitStatus: (p, fresh) => fetchJson('/api/git/status' + q({ path: p, fresh: fresh ? '1' : undefined })),
    getHomeDir: async () => status.homeDir,
    getVersion: async () => status.version,
    getBuildInfo: async () => status.buildInfo,

    // ---- session restore: remote never touches the desktop's file -------
    sessionLoadLast: async () => null,
    sessionSaveLast: noop,
    sessionClearLast: noop,

    // ---- clipboard --------------------------------------------------------
    // Image paste on the browser page goes through TerminalPanel's paste
    // handler → clipboardSaveImage. A browser cannot read the clipboard on
    // demand over plain http, so this resolves null; the panel then falls
    // back to text paste. Image upload remains available via the phone UI.
    clipboardSaveImage: async () => null,
    clipboardReadFiles: async () => null,
    clipboardWriteText: async (text) => { deps.copyText(text) },

    // ---- desktop-only: stubs -----------------------------------------------
    openPath: async () => ({ ok: false, error: 'Not available remotely' }),
    adminShellMode: async () => 'external' as const,
    openAdminShell: async () => ({ ok: false, error: 'Not available remotely' }),
    readFile: async () => null,
    projectCreate: async () => null,
    openrouterModels: async () => ({ fetchedAt: 0, models: [] }),
    settingsGetBudgetState: async () => null,
    settingsSetBudgetCap: async () => undefined,
    settingsResetTodaySpend: async () => undefined,
    windowCreate: async () => '',
    windowList: async () => [],
    onWindowCloseRequest: unsub,
    windowConfirmClose: noop,
    openExternal: async (url) => { try { window.open(url, '_blank', 'noopener') } catch {} },
    openInExplorer: noop,
    openInEditor: async () => ({ ok: false, error: 'Not available remotely' }),
    editorProbeProject: async () => null,
    editorGetAvailable: async () => [],
    editorGetDefaults: async () => ({ global: '', project: '', resolvedId: null }),
    editorSetDefault: async () => ({ ok: false }),
    onWindowListUpdated: unsub,
    claudeConfigRead: async () => ({ global: {}, local: {} }),
    claudeConfigWrite: noop,
    remoteToggle: async () => ({ ok: false, error: 'Not available remotely' }),
    remoteStatus: async () => ({ running: true, port: 0, urls: [] }),
    tailscaleStatus: async () => ({
      installed: false, loggedIn: false, online: false, httpsEnabled: false,
      httpsHost: null, error: null, serveActive: false, serveUrl: null,
    }),
    tailscaleServeStart: async () => ({ ok: false, error: 'Not available remotely' }),
    tailscaleServeStop: async () => ({ ok: false, error: 'Not available remotely' }),
    onRemoteSessionCreated: unsub,
    autopilotKeyExists: async () => false,
    autopilotKeySet: noop,
    autopilotKeyClear: noop,
    autopilotStart: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotProStart: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotCouncilStart: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotProRunMeta: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotPause: noop,
    autopilotResume: noop,
    autopilotStop: noop,
    autopilotApproveGoal: noop,
    autopilotReplyToWaiting: async () => ({ ok: false, error: 'Not available remotely' }),
    autopilotPermissionAllow: async () => undefined,
    autopilotPermissionDeny: async () => undefined,
    autopilotGetStatus: async () => null,
    autopilotInspectOutput: async () => null,
    autopilotProbeArtifacts: async () => null,
    autopilotAttachDraft: async () => null,
    autopilotAttachConfirm: async () => null,
    autopilotAttachStatus: async () => null,
    autopilotAttachCancel: async () => null,
    broadcastRefine: async () => ({ ok: false, error: 'Not available remotely' }),
    broadcastSend: async () => ({ ok: false, results: [] }),
    aiUsageSummary: async () => ({
      sites: [], keys: { anthropic: false, openrouter: false },
      refine: { count: 0, byModel: {}, avgMs: null }, broadcastsLogged: 0,
    }),
    terminalListExternal: async () => [],
    terminalOpenExternal: async () => ({ ok: false, error: 'Not available remotely' }),
    promptsList: async () => [],
    promptsDelete: async () => ({ ok: false }),
    promptsClear: async () => ({ ok: false }),
    promptsCount: async () => 0,
    onAutopilotUpdate: unsub,
  }

  return api
```

If `tsc` reports a member whose return type does not match `ElectronAPI` (the `.d.ts` is the source of truth), adjust the stub's value to the declared type; never change the `.d.ts` to fit the stub.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run tests/remote-api.test.ts && npx tsc --noEmit -p tsconfig.web.json`
Expected: tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/remote/remote-api.ts src/renderer/src/types/api.d.ts tests/remote-api.test.ts
git commit -m "feat(remote): complete the transport adapter surface with stubs for desktop-only calls"
```

---

### Task 6: Bootstrap helpers, `remote.html` entry, and the Vite multi-entry build

**Files:**
- Create: `src/renderer/src/remote/uuid-polyfill.ts`
- Create: `src/renderer/src/remote/copy-text.ts`
- Create: `src/renderer/src/remote/path-prompt.ts`
- Create: `src/renderer/src/remote-main.tsx`
- Create: `src/renderer/remote.html`
- Modify: `electron.vite.config.ts`
- Test: `tests/remote-bootstrap-helpers.test.ts`, `tests/remote-desktop-page.test.ts`

**Interfaces:**
- Produces:
  - `installRandomUuidPolyfill(c: { randomUUID?: () => string; getRandomValues: (a: Uint8Array) => Uint8Array }): void`
  - `copyText(text: string): boolean`
  - `promptForPath(): Promise<string | null>`
  - Build output `out/renderer/remote.html` plus hashed assets.

- [ ] **Step 1: Write the failing helper tests**

Create `tests/remote-bootstrap-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { installRandomUuidPolyfill } from '../src/renderer/src/remote/uuid-polyfill'
import { copyText } from '../src/renderer/src/remote/copy-text'

describe('installRandomUuidPolyfill', () => {
  it('adds a v4-shaped randomUUID when the context lacks one (plain http on a LAN IP)', () => {
    const c: any = { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = i * 37 % 256; return a } }
    installRandomUuidPolyfill(c)
    const id = c.randomUUID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('leaves an existing randomUUID alone', () => {
    const orig = () => 'native'
    const c: any = { randomUUID: orig, getRandomValues: (a: Uint8Array) => a }
    installRandomUuidPolyfill(c)
    expect(c.randomUUID).toBe(orig)
  })
})

describe('copyText', () => {
  it('returns false and does not throw when neither clipboard API nor document exists', () => {
    expect(copyText('x')).toBe(false)
  })
  it('returns false for empty text', () => {
    expect(copyText('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/remote-bootstrap-helpers.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the helpers**

`src/renderer/src/remote/uuid-polyfill.ts`:

```ts
/** crypto.randomUUID exists only in secure contexts. The remote page is plain
 *  http on a LAN or Tailscale IP, which is not one, and App.tsx mints every
 *  tile id with it. getRandomValues is available everywhere. */
export function installRandomUuidPolyfill(c: { randomUUID?: () => string; getRandomValues: (a: Uint8Array) => Uint8Array }): void {
  if (typeof c.randomUUID === 'function') return
  c.randomUUID = () => {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
}
```

`src/renderer/src/remote/copy-text.ts`:

```ts
/** Clipboard write that also works over plain http (not a secure context, so
 *  navigator.clipboard is absent). Ported from remote-ui/terminal-view.js. */
export function copyText(text: string): boolean {
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && (globalThis as any).isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
      return true
    }
  } catch {}
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', 'readonly')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  let ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    ok = document.execCommand('copy')
  } catch {}
  document.body.removeChild(ta)
  return ok
}
```

`src/renderer/src/remote/path-prompt.ts`:

```ts
/** Browser stand-in for the native folder picker: a small in-page prompt
 *  where the user types or pastes a folder path on the host machine. */
export function promptForPath(): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:monospace'
    wrap.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;width:min(520px,90vw)">
        <div style="color:#e0e0e0;font-size:13px;margin-bottom:10px">Open project — folder path on the host</div>
        <input type="text" placeholder="/path/to/project" autocomplete="off"
          style="width:100%;box-sizing:border-box;background:#0d0d0d;color:#d4d4d4;border:1px solid #444;border-radius:4px;padding:8px;font:inherit">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button data-act="cancel" style="background:#2a2a3a;color:#ccc;border:1px solid #444;border-radius:4px;padding:6px 12px;font:inherit">Cancel</button>
          <button data-act="open" style="background:#6366f1;color:#fff;border:0;border-radius:4px;padding:6px 12px;font:inherit">Open</button>
        </div>
      </div>`
    const input = wrap.querySelector('input')!
    const done = (value: string | null) => { wrap.remove(); resolve(value) }
    wrap.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null))
    wrap.querySelector('[data-act="open"]')!.addEventListener('click', () => done(input.value.trim() || null))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null)
      if (e.key === 'Escape') done(null)
    })
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null) })
    document.body.appendChild(wrap)
    input.focus()
  })
}
```

- [ ] **Step 4: Run helper tests**

Run: `npx vitest run tests/remote-bootstrap-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing page test**

Create `tests/remote-desktop-page.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '..', 'src', 'renderer')
const index = readFileSync(join(dir, 'index.html'), 'utf-8')
const remote = readFileSync(join(dir, 'remote.html'), 'utf-8')

function styleBlock(html: string): string {
  const s = html.indexOf('<style>')
  const e = html.indexOf('</style>', s)
  return html.slice(s, e + '</style>'.length).replace(/\r\n/g, '\n')
}

describe('remote.html (the /desktop page)', () => {
  it('carries exactly the same base styles as index.html so the two pages cannot drift', () => {
    expect(styleBlock(remote)).toBe(styleBlock(index))
  })
  it('loads the socket.io client from the server before the module entry', () => {
    const io = remote.indexOf('<script src="/socket.io/socket.io.js"></script>')
    const entry = remote.indexOf('<script type="module" src="./src/remote-main.tsx"></script>')
    expect(io).toBeGreaterThan(-1)
    expect(entry).toBeGreaterThan(io)
  })
  it('has its own title', () => {
    expect(remote).toContain('<title>CmdCLD Remote</title>')
  })
})
```

- [ ] **Step 6: Create `remote.html`**

Copy `src/renderer/index.html` to `src/renderer/remote.html` byte-for-byte, then make exactly these edits:

1. `<title>CmdCLD</title>` → `<title>CmdCLD Remote</title>`
2. Replace the body with:

```html
<body>
  <div id="root"></div>
  <script src="/socket.io/socket.io.js"></script>
  <script type="module" src="./src/remote-main.tsx"></script>
</body>
```

- [ ] **Step 7: Create `remote-main.tsx`**

```tsx
// src/renderer/src/remote-main.tsx
//
// Entry for the /desktop page. Installs the transport adapter as window.api
// *before* App is imported (components read window.api at render time, but
// the import is dynamic so nothing can observe it undefined), then mounts the
// same App the Electron window mounts.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { installRandomUuidPolyfill } from './remote/uuid-polyfill'
import { fetchJson } from './remote/fetch-json'
import { createRemoteApi, type RemoteStatus, type SocketLike } from './remote/remote-api'
import { copyText } from './remote/copy-text'
import { promptForPath } from './remote/path-prompt'

declare const io: (opts?: Record<string, unknown>) => SocketLike & {
  io: { on(event: string, cb: () => void): void }
}

async function boot(): Promise<void> {
  installRandomUuidPolyfill(globalThis.crypto as any)
  const status = await fetchJson<RemoteStatus>('/api/status')
  const socket = io({ reconnection: true, reconnectionDelay: 1000 })
  window.api = createRemoteApi({ socket, fetchJson, status, promptForPath, copyText })

  // Reconnect = the desktop's own recovery path: reload, and App rebuilds the
  // tiles from the server's live sessions under their original ids.
  socket.io.on('reconnect', () => { location.reload() })
  socket.on('disconnect', () => { document.body.dataset.remoteDisconnected = '1' })
  socket.on('connect', () => { delete document.body.dataset.remoteDisconnected })

  const { default: App } = await import('./App')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

boot().catch((e) => {
  const root = document.getElementById('root')!
  root.style.cssText = 'height:100vh;display:flex;align-items:center;justify-content:center;color:#888;font-family:monospace'
  root.textContent = 'Could not reach CmdCLD: ' + (e instanceof Error ? e.message : String(e))
})
```

Add to the `<style>` of **both** `index.html` and `remote.html` (keep them identical — the test enforces it), at the end of the block:

```css
    /* /desktop page: dim tile headers while the socket is down. Inert in Electron. */
    body[data-remote-disconnected] .drag-handle { opacity: 0.5; }
```

- [ ] **Step 8: Add the second entry to the Vite config**

In `electron.vite.config.ts`:

```ts
import { resolve } from 'path'
// ...
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          remote: resolve(__dirname, 'src/renderer/remote.html'),
        },
      },
    },
  },
```

(Keep the existing `import { join } from 'path'`; add `resolve` to it.)

- [ ] **Step 9: Run tests, type check and the build**

Run: `npx vitest run tests/remote-desktop-page.test.ts tests/remote-bootstrap-helpers.test.ts && npx tsc --noEmit -p tsconfig.web.json && npm run build && ls out/renderer`
Expected: tests PASS, tsc clean, build succeeds, listing shows both `index.html` and `remote.html` plus `assets/` and `fonts/`.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/remote.html src/renderer/index.html src/renderer/src/remote-main.tsx src/renderer/src/remote/uuid-polyfill.ts src/renderer/src/remote/copy-text.ts src/renderer/src/remote/path-prompt.ts electron.vite.config.ts tests/remote-bootstrap-helpers.test.ts tests/remote-desktop-page.test.ts
git commit -m "feat(remote): browser entry for the desktop renderer with bootstrap helpers"
```

---

### Task 7: Hide desktop-only controls when `window.api.remote`

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` (New Window button ~line 373, Broadcast button ~line 364)
- Modify: `src/renderer/src/components/TerminalPanel.tsx` (editor button ~854, explorer button ~875, autopilot buttons ~881–898)
- Modify: `src/renderer/src/App.tsx` (context menu ~1197–1206; `onToggleBroadcast` ~965)

**Interfaces:**
- Consumes: `window.api.remote?: boolean` from Task 5.
- Produces: nothing new. Behaviour: on the browser page the listed controls are not rendered.

No unit test harness exists for React components in this repo (no jsdom / testing-library), so this task is verified by `tsc`, the full test suite, and the manual checklist in Task 9.

- [ ] **Step 1: Sidebar**

Wrap the Broadcast button and the New Window button:

```tsx
        {!window.api.remote && (
          <button
            onClick={onToggleBroadcast}
            /* ...existing props unchanged... */
          >
            {/* ...existing children unchanged... */}
          </button>
        )}
        {!window.api.remote && (
          <button onClick={onNewWindow} style={btnStyle()} className="sidebar-btn" title="New Window">
            {/* ...existing children unchanged... */}
          </button>
        )}
```

- [ ] **Step 2: TerminalPanel**

Wrap the "open in editor" button, the "Open in Finder/Explorer" button, and the two autopilot buttons with `{!window.api.remote && ( ... )}`. For the autopilot buttons, extend the existing conditions instead of nesting:

```tsx
        {!isPlainShell && onStartAutopilot && !isAutopilotRunning && !window.api.remote && (
```
```tsx
        {!isPlainShell && isAutopilotRunning && onShowAutopilotPanel && !window.api.remote && (
```

Keep the Open shell, Minimize and Maximize buttons untouched.

- [ ] **Step 3: App context menu and broadcast toggle**

In the `ContextMenu` `items` array, replace the `'Open in new window'` and `'Start with Autopilot'` entries with a conditional spread:

```tsx
              ...(window.api.remote ? [] : [
                { label: 'Open in new window', icon: AppWindow, onClick: () => { window.api.windowCreate().catch(() => {}) } },
                { label: 'Start with Autopilot', icon: Sparkles, onClick: () => {
                  handleOpenRecent(path)
                  setTimeout(() => {
                    const t = terminals.find((tt) => tt.path === path)
                    if (t) setAutopilotKickoffFor(t.id)
                  }, 200)
                }},
              ]),
```

Do the same for the external-terminal entries that follow (the "One entry per detected terminal" block): wrap them in `...(window.api.remote ? [] : [ ... ])`. The `externalTerminals` list is already `[]` remotely, so this is belt-and-braces; it keeps the divider from rendering above an empty group.

Change the Sidebar prop:

```tsx
        onToggleBroadcast={() => { if (!window.api.remote) setBroadcastOpen((v) => !v) }}
```

Find the keyboard shortcut handler for Ctrl/Cmd+B (search `'b'` in the `keydown` handler) and add the same guard before `setBroadcastOpen`.

- [ ] **Step 4: Type check, full tests, build**

Run: `npx tsc --noEmit -p tsconfig.web.json && npm test && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/TerminalPanel.tsx src/renderer/src/App.tsx
git commit -m "feat(remote): hide desktop-only controls on the browser page"
```

---

### Task 8: Page-select rule and redirects between `/` and `/desktop/`

**Files:**
- Create: `src/remote-ui/page-select.js`
- Modify: `src/remote-ui/index.html` (head), `src/renderer/remote.html` (head)
- Test: `tests/remote-page-select.test.ts`, `tests/remote-desktop-page.test.ts` (append)

**Interfaces:**
- Produces: `window.CmdCLD_PageSelect.choosePage({ page, width, search, stored })` → `{ go: null | '/' | '/desktop/', remember: null | 'mobile' | 'desktop' }`. Storage key `cmdcld-remote-page`.

- [ ] **Step 1: Write the failing tests**

Create `tests/remote-page-select.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
// Browser IIFE with a CommonJS export, same pattern as input-sanitizer.js.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { choosePage, STORAGE_KEY } = require('../src/remote-ui/page-select.js')

describe('choosePage', () => {
  it('sends a wide viewport on the phone page to /desktop/', () => {
    expect(choosePage({ page: 'mobile', width: 769, search: '', stored: null })).toEqual({ go: '/desktop/', remember: null })
  })
  it('keeps a narrow viewport on the phone page', () => {
    expect(choosePage({ page: 'mobile', width: 768, search: '', stored: null })).toEqual({ go: null, remember: null })
  })
  it('sends a narrow viewport on the desktop page back to /', () => {
    expect(choosePage({ page: 'desktop', width: 500, search: '', stored: null })).toEqual({ go: '/', remember: null })
  })
  it('?mobile wins over width and is remembered', () => {
    expect(choosePage({ page: 'mobile', width: 1400, search: '?mobile', stored: 'desktop' })).toEqual({ go: null, remember: 'mobile' })
    expect(choosePage({ page: 'desktop', width: 1400, search: '?mobile', stored: null })).toEqual({ go: '/', remember: 'mobile' })
  })
  it('?desktop wins over width and is remembered', () => {
    expect(choosePage({ page: 'mobile', width: 400, search: '?desktop=1', stored: 'mobile' })).toEqual({ go: '/desktop/', remember: 'desktop' })
    expect(choosePage({ page: 'desktop', width: 400, search: '?desktop', stored: null })).toEqual({ go: null, remember: 'desktop' })
  })
  it('a stored choice beats width', () => {
    expect(choosePage({ page: 'mobile', width: 1400, search: '', stored: 'mobile' })).toEqual({ go: null, remember: null })
    expect(choosePage({ page: 'mobile', width: 400, search: '', stored: 'desktop' })).toEqual({ go: '/desktop/', remember: null })
    expect(choosePage({ page: 'desktop', width: 1400, search: '', stored: 'mobile' })).toEqual({ go: '/', remember: null })
  })
  it('exports the storage key', () => {
    expect(STORAGE_KEY).toBe('cmdcld-remote-page')
  })
})
```

Append to `tests/remote-desktop-page.test.ts`:

```ts
describe('page-select wiring', () => {
  const mobile = readFileSync(join(__dirname, '..', 'src', 'remote-ui', 'index.html'), 'utf-8')
  it('both pages load page-select.js and run it before their own scripts', () => {
    for (const [html, page] of [[mobile, 'mobile'], [remote, 'desktop']] as const) {
      const lib = html.indexOf('<script src="/page-select.js"></script>')
      expect(lib, page).toBeGreaterThan(-1)
      expect(html.indexOf(`CmdCLD_PageSelect.apply('${page}')`), page).toBeGreaterThan(lib)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/remote-page-select.test.ts tests/remote-desktop-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `page-select.js`**

```js
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
```

- [ ] **Step 4: Wire both pages**

In `src/remote-ui/index.html`, immediately after `<link rel="stylesheet" href="/style.css">` in the head:

```html
  <script src="/page-select.js"></script>
  <script>window.CmdCLD_PageSelect.apply('mobile')</script>
```

In `src/renderer/remote.html`, immediately after `<title>CmdCLD Remote</title>`:

```html
  <script src="/page-select.js"></script>
  <script>window.CmdCLD_PageSelect.apply('desktop')</script>
```

The test looks for the literal call `CmdCLD_PageSelect.apply('mobile')` / `apply('desktop')` after the library tag.

`/page-select.js` is served by the existing remote-ui static mount at the server root, so the absolute path works from `/desktop/` too.

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run tests/remote-page-select.test.ts tests/remote-desktop-page.test.ts tests/remote-ui-layout.test.ts && npm run build`
Expected: PASS; build succeeds (the `copy-remote-ui` plugin copies the new file).

- [ ] **Step 6: Commit**

```bash
git add src/remote-ui/page-select.js src/remote-ui/index.html src/renderer/remote.html tests/remote-page-select.test.ts tests/remote-desktop-page.test.ts
git commit -m "feat(remote): route wide viewports to /desktop and phones to /"
```

---

### Task 9: End-to-end verification and docs

**Files:**
- Modify: `CLAUDE.md` (add a "Remote desktop page" section under "Layout")

- [ ] **Step 1: Full build and test**

Run: `npm test && npm run build && npx tsc --noEmit -p tsconfig.web.json`
Expected: all green.

- [ ] **Step 2: Package and launch the Mac app**

Run: `npx electron-builder --mac dmg --arm64 && open dist/mac-arm64/CmdCLD.app`

In the app: Settings → enable Remote Access. Note the port shown.

- [ ] **Step 3: Manual checklist (record each result in the commit message of Step 5)**

In Chrome on this Mac, window ≥ 1000 px wide:

1. Open `http://localhost:<port>/` → lands on `/desktop/`. Sidebar, empty workspace visible.
2. Sidebar → Open Project → path prompt → enter a project path → a tile appears, agent launches once (watch the desktop app: the same tile appears there, no second launch).
3. Add sessions until there are 2, 3, 4, 5 → grid goes 2x1, 3x1, 2x2, 3x2 exactly like desktop.
4. Double-click a tile header → focused; double-click again → grid.
5. Minimize a tile → taskbar chip; click chip → restored.
6. Drag a tile by its header; resize from the corner → works; add a session → arrangement resets (same as desktop).
7. Resize a tile in the browser → the desktop tile's xterm follows (type `tput cols` in both).
8. Resize a tile on the desktop → the browser tile follows.
9. Confirm no New Window, Broadcast, Open in Finder/Editor, or Autopilot buttons are visible.
10. Narrow the browser window below 769 px and reload → `/` phone UI. Append `?desktop` → back to `/desktop/` and it sticks across reloads; `?mobile` reverses it.
11. Kill the remote server (disable Remote Access) → tile headers dim; re-enable → page reloads and tiles come back under the same ids with scrollback.

If any item fails, fix it in the owning task's files, re-run that task's tests, and re-check before continuing.

- [ ] **Step 4: Document**

Append to `CLAUDE.md` after the "Layout" tree:

```markdown
## Remote desktop page

`src/renderer/remote.html` + `src/remote-main.tsx` build the **same React App** for the browser;
the remote server serves it at `/desktop/` from `out/renderer` (dev needs `npm run build` once).
`src/renderer/src/remote/remote-api.ts` is the `window.api` implementation over Socket.IO + REST;
`window.api.remote === true` there, and components hide desktop-only controls on it.
`src/remote-ui/` stays the phone UI at `/`; `page-select.js` redirects by width (769 px) with
`?mobile` / `?desktop` overrides. PTY size is "last fit wins" across desktop and remote by design
(single user, one device at a time).
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: remote desktop page

Manual checks (Task 9): <list each of the 11 items with pass/fail>"
```
