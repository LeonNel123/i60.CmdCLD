import { createServer, type Server } from 'http'
import type { RelaySendResult } from './types'

// Minimal MCP server (streamable-HTTP, stateless JSON responses) exposing the
// relay to Claude Code sessions running inside CmdCLD:
//   relay_notify(to, subject, path)  — `from` is host-stamped via the caller's
//                                      session token, never client-supplied
//   list_sessions()                  — sessions addressable right now
//
// Deliberately NOT mounted on RemoteServer: that binds 0.0.0.0 and only runs
// when remote access is enabled. This one is always-on and 127.0.0.1-only.
// Callers authenticate with the X-CmdCLD-Session header (token minted into
// the pty's env at spawn); no token → the tools explain themselves and fail.

export interface McpRelayDeps {
  resolveToken: (token: string) => string | null
  sessionName: (terminalId: string) => string | null
  listSessions: () => Array<{ id: string; name: string; projectPath: string; idle: boolean }>
  sendRelay: (args: { from: string; to: string; subject: string; path: string }) => Promise<RelaySendResult>
}

const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  {
    name: 'relay_notify',
    description:
      'Notify another CmdCLD session that a document awaits it. Delivers a fixed-format, pointer-only nudge into that session (staged in its composer; a human submits it). The sender name is stamped by the host from your session identity. The path must be a file inside an exchange authoring location: a repo\'s docs/integration/outbound/, or a domain exchange hub\'s outbound/ (a hub root has inbound/ and REPOS.md beside it).',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target session name or id (see list_sessions)' },
        subject: { type: 'string', description: 'One line, max 120 chars after sanitization' },
        path: { type: 'string', description: 'Absolute path to the document, inside docs/integration/outbound/ or a domain hub\'s outbound/' },
      },
      required: ['to', 'subject', 'path'],
    },
  },
  {
    name: 'list_sessions',
    description: 'List CmdCLD sessions addressable by relay_notify: id, name, project path, and whether each is currently idle.',
    inputSchema: { type: 'object', properties: {} },
  },
]

interface JsonRpcRequest {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

type JsonRpcResponse = Record<string, unknown> | null

function rpcResult(id: number | string | null | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: number | string | null | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function toolText(text: string, isError = false): unknown {
  return { content: [{ type: 'text', text }], isError }
}

// Pure request handler — the http listener is a thin shell around this so
// tests can drive it directly. Returns null for notifications (no response).
export async function handleMcpMessage(
  msg: JsonRpcRequest,
  senderTerminalId: string | null,
  deps: McpRelayDeps,
): Promise<JsonRpcResponse> {
  const method = msg.method ?? ''
  if (method.startsWith('notifications/')) return null

  switch (method) {
    case 'initialize':
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'cmdcld-relay', version: '1.0.0' },
      })
    case 'ping':
      return rpcResult(msg.id, {})
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS })
    case 'tools/call': {
      const name = (msg.params?.name as string) ?? ''
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {}
      if (name === 'list_sessions') {
        return rpcResult(msg.id, toolText(JSON.stringify(deps.listSessions(), null, 2)))
      }
      if (name === 'relay_notify') {
        if (!senderTerminalId) {
          return rpcResult(msg.id, toolText(
            'Relay requires running inside CmdCLD: no valid session token was presented. ' +
            'Sessions launched outside CmdCLD cannot send relays.', true))
        }
        const from = deps.sessionName(senderTerminalId)
        if (!from) {
          return rpcResult(msg.id, toolText('Sender session no longer exists.', true))
        }
        const res = await deps.sendRelay({
          from,
          to: String(args.to ?? ''),
          subject: String(args.subject ?? ''),
          path: String(args.path ?? ''),
        })
        if (!res.ok) {
          return rpcResult(msg.id, toolText(`Relay refused: ${res.error ?? 'unknown reason'}`, true))
        }
        return rpcResult(msg.id, toolText(
          res.status === 'delivered'
            ? `Relay staged in the target session's composer (id ${res.id}). A human submits it there.`
            : `Relay queued (id ${res.id}) — it will stage when the target session is idle and resolvable.`))
      }
      return rpcError(msg.id, -32602, `Unknown tool: ${name}`)
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${method}`)
  }
}

export interface McpServerHandle {
  server: Server
  port: number
  url: string
}

const DEFAULT_PORT = 4664
const MAX_PORT_TRIES = 8

export function startMcpServer(deps: McpRelayDeps, preferredPort = DEFAULT_PORT): Promise<McpServerHandle> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' })
      res.end(JSON.stringify({ error: 'POST only' }))
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      void (async () => {
        let parsed: JsonRpcRequest
        try {
          parsed = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(rpcError(null, -32700, 'Parse error')))
          return
        }
        const tokenHeader = req.headers['x-cmdcld-session']
        const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader
        const senderTerminalId = token ? deps.resolveToken(token) : null
        const response = await handleMcpMessage(parsed, senderTerminalId, deps)
        if (response === null) {
          res.writeHead(202)
          res.end()
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response))
        }
      })().catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(rpcError(null, -32603, 'Internal error')))
      })
    })
  })

  return new Promise((resolve, reject) => {
    let attempt = 0
    const tryListen = (port: number): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES) {
          attempt += 1
          tryListen(port + 1)
        } else {
          reject(err)
        }
      })
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error')
        resolve({ server, port, url: `http://127.0.0.1:${port}/mcp` })
      })
    }
    tryListen(preferredPort)
  })
}
