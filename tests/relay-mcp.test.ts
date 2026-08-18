import { describe, it, expect, vi } from 'vitest'
import { handleMcpMessage, type McpRelayDeps } from '../src/main/relay/mcp-server'
import { SessionTokens } from '../src/main/relay/session-tokens'

const OUTBOUND_DOC = 'D:\\repo\\docs\\integration\\outbound\\X-REQ-001-thing.md'

function makeDeps(overrides: Partial<McpRelayDeps> = {}): McpRelayDeps & { sendCalls: unknown[] } {
  const sendCalls: unknown[] = []
  return {
    sendCalls,
    resolveToken: (token) => (token === 'good-token' ? 't1' : null),
    sessionName: (id) => (id === 't1' ? 'release-manager' : null),
    listSessions: () => [{ id: 't1', name: 'release-manager', projectPath: 'D:\\repo', idle: true }],
    sendRelay: async (args) => {
      sendCalls.push(args)
      return { ok: true, status: 'delivered', id: 'relay-1' }
    },
    ...overrides,
  }
}

interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

function resultOf(response: Record<string, unknown> | null): ToolResult {
  return (response as { result: ToolResult }).result
}

describe('SessionTokens', () => {
  it('issues a stable token per session and resolves it back', () => {
    const tokens = new SessionTokens()
    const t = tokens.issue('term-1')
    expect(tokens.issue('term-1')).toBe(t)
    expect(tokens.resolve(t)).toBe('term-1')
    expect(t.length).toBeGreaterThanOrEqual(32)
  })

  it('revoke kills the token', () => {
    const tokens = new SessionTokens()
    const t = tokens.issue('term-1')
    tokens.revoke('term-1')
    expect(tokens.resolve(t)).toBe(null)
    // a re-issued token is a fresh one
    expect(tokens.issue('term-1')).not.toBe(t)
  })

  it('never resolves unknown tokens', () => {
    expect(new SessionTokens().resolve('made-up')).toBe(null)
  })
})

describe('handleMcpMessage', () => {
  it('answers initialize with server info and tool capability', async () => {
    const res = await handleMcpMessage({ id: 1, method: 'initialize' }, null, makeDeps())
    const result = (res as { result: { serverInfo: { name: string }; capabilities: { tools: object } } }).result
    expect(result.serverInfo.name).toBe('cmdcld-relay')
    expect(result.capabilities.tools).toBeDefined()
  })

  it('swallows notifications (no response)', async () => {
    const res = await handleMcpMessage({ method: 'notifications/initialized' }, null, makeDeps())
    expect(res).toBe(null)
  })

  it('lists both tools', async () => {
    const res = await handleMcpMessage({ id: 2, method: 'tools/list' }, null, makeDeps())
    const tools = (res as { result: { tools: Array<{ name: string }> } }).result.tools
    expect(tools.map((t) => t.name).sort()).toEqual(['list_sessions', 'relay_notify'])
  })

  it('list_sessions works without a token', async () => {
    const res = await handleMcpMessage(
      { id: 3, method: 'tools/call', params: { name: 'list_sessions', arguments: {} } },
      null, makeDeps(),
    )
    const out = resultOf(res)
    expect(out.isError).toBeFalsy()
    expect(out.content[0].text).toContain('release-manager')
    // projectPath is part of the committed shape (response §1).
    expect(out.content[0].text).toContain('projectPath')
  })

  it('relay_notify without a valid token fails gracefully and explains itself', async () => {
    const deps = makeDeps()
    const res = await handleMcpMessage(
      { id: 4, method: 'tools/call', params: { name: 'relay_notify', arguments: { to: 'x', subject: 's', path: OUTBOUND_DOC } } },
      null, deps,
    )
    const out = resultOf(res)
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toContain('inside CmdCLD')
    expect(deps.sendCalls).toHaveLength(0)
  })

  it('relay_notify stamps `from` from the caller session — client cannot supply it', async () => {
    const deps = makeDeps()
    const res = await handleMcpMessage(
      {
        id: 5, method: 'tools/call',
        params: {
          name: 'relay_notify',
          // hostile: tries to smuggle a from
          arguments: { to: 'toms-security', subject: 'hi', path: OUTBOUND_DOC, from: 'somebody-else' },
        },
      },
      't1', deps,
    )
    expect(deps.sendCalls).toHaveLength(1)
    expect((deps.sendCalls[0] as { from: string }).from).toBe('release-manager')
    const out = resultOf(res)
    expect(out.isError).toBeFalsy()
    expect(out.content[0].text).toContain('inbox')
  })

  it('surfaces relay refusals as tool errors', async () => {
    const deps = makeDeps({
      sendRelay: async () => ({ ok: false, status: 'refused', id: 'r', error: 'path must be inside…' }),
    })
    const res = await handleMcpMessage(
      { id: 6, method: 'tools/call', params: { name: 'relay_notify', arguments: { to: 'x', subject: 's', path: 'C:\\bad' } } },
      't1', deps,
    )
    const out = resultOf(res)
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toContain('refused')
  })

  it('rejects unknown tools and unknown methods', async () => {
    const badTool = await handleMcpMessage(
      { id: 7, method: 'tools/call', params: { name: 'nope', arguments: {} } }, null, makeDeps(),
    )
    expect((badTool as { error: { code: number } }).error.code).toBe(-32602)
    const badMethod = await handleMcpMessage({ id: 8, method: 'wat' }, null, makeDeps())
    expect((badMethod as { error: { code: number } }).error.code).toBe(-32601)
  })

  it('reports a dead sender session instead of relaying', async () => {
    const deps = makeDeps({ sessionName: () => null })
    const res = await handleMcpMessage(
      { id: 9, method: 'tools/call', params: { name: 'relay_notify', arguments: { to: 'x', subject: 's', path: OUTBOUND_DOC } } },
      't1', deps,
    )
    expect(resultOf(res).isError).toBe(true)
    expect(deps.sendCalls).toHaveLength(0)
  })
})
