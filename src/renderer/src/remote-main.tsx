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
