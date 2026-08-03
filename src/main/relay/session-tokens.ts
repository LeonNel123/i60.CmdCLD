import { randomBytes } from 'crypto'

// Opaque per-session tokens for MCP caller identity (CMDCLD-REQ-001-response
// §1): the host stamps `from` itself by mapping the caller's token back to
// its session. Tokens are minted at pty spawn, never persisted, and die with
// the session — a session can only ever speak as itself.

export class SessionTokens {
  private byToken = new Map<string, string>()
  private byId = new Map<string, string>()

  issue(terminalId: string): string {
    const existing = this.byId.get(terminalId)
    if (existing) return existing
    const token = randomBytes(24).toString('hex')
    this.byToken.set(token, terminalId)
    this.byId.set(terminalId, token)
    return token
  }

  resolve(token: string): string | null {
    return this.byToken.get(token) ?? null
  }

  revoke(terminalId: string): void {
    const token = this.byId.get(terminalId)
    if (token) this.byToken.delete(token)
    this.byId.delete(terminalId)
  }
}
