import { describe, expect, it } from 'vitest'
import { isRequestAllowed, namesTailscaleHost } from '../src/main/remote-guard'

const LOOPBACK = { lanAccess: false, lanAddresses: ['192.168.1.20'], tailscaleHosts: ['mymachine.tail1234.ts.net'] }
const LAN = { lanAccess: true, lanAddresses: ['192.168.1.20'], tailscaleHosts: ['mymachine.tail1234.ts.net'] }

describe('isRequestAllowed', () => {
  it('allows loopback hosts with and without port', () => {
    expect(isRequestAllowed('localhost:3456', undefined, LOOPBACK)).toBe(true)
    expect(isRequestAllowed('localhost', undefined, LOOPBACK)).toBe(true)
    expect(isRequestAllowed('127.0.0.1:3456', undefined, LOOPBACK)).toBe(true)
    expect(isRequestAllowed('[::1]:3456', undefined, LOOPBACK)).toBe(true)
  })

  it('allows Tailscale serve hostnames', () => {
    expect(isRequestAllowed('mymachine.tail1234.ts.net', undefined, LOOPBACK)).toBe(true)
    expect(isRequestAllowed('MyMachine.Tail1234.TS.NET', undefined, LOOPBACK)).toBe(true)
  })

  // Anyone can publish a page on their own *.ts.net name (Tailscale Funnel).
  // A suffix match let such a page open a socket to localhost and drive every PTY.
  it('rejects other machines\' .ts.net names, as Host or as Origin', () => {
    expect(isRequestAllowed('attacker.tail9999.ts.net', undefined, LOOPBACK)).toBe(false)
    expect(isRequestAllowed('localhost:3456', 'https://attacker.tail9999.ts.net', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('localhost:3456', 'https://mymachine.tail1234.ts.net', { lanAccess: false, lanAddresses: [] })).toBe(false)
  })

  it('rejects arbitrary hostnames (DNS rebinding)', () => {
    expect(isRequestAllowed('evil.example.com:3456', undefined, LOOPBACK)).toBe(false)
    expect(isRequestAllowed('fakets.net', undefined, LOOPBACK)).toBe(false)
  })

  it('rejects a missing Host header', () => {
    expect(isRequestAllowed(undefined, undefined, LOOPBACK)).toBe(false)
    expect(isRequestAllowed('', undefined, LOOPBACK)).toBe(false)
  })

  it('allows this machine\'s LAN IPs only when LAN mode is on', () => {
    expect(isRequestAllowed('192.168.1.20:3456', undefined, LOOPBACK)).toBe(false)
    expect(isRequestAllowed('192.168.1.20:3456', undefined, LAN)).toBe(true)
    expect(isRequestAllowed('192.168.1.99:3456', undefined, LAN)).toBe(false)
  })

  it('validates Origin when present (cross-site WebSocket hijack)', () => {
    expect(isRequestAllowed('localhost:3456', 'http://localhost:3456', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('localhost:3456', 'https://mymachine.tail1234.ts.net', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('localhost:3456', 'https://evil.example.com', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('localhost:3456', 'null', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('localhost:3456', 'not a url', LOOPBACK)).toBe(false)
  })

  // Comparing only the hostname let any page served from this machine — a dev
  // server, a notebook, a docs preview — open the socket and type into PTYs.
  it('rejects a page on another local port', () => {
    expect(isRequestAllowed('localhost:3456', 'http://localhost:5173', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('localhost:3456', 'http://127.0.0.1:8888', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('localhost:3456', 'http://localhost', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('127.0.0.1:3456', 'http://[::1]:9000', LOOPBACK)).toBe(false)
    expect(isRequestAllowed('192.168.1.20:3456', 'http://192.168.1.20:8080', LAN)).toBe(false)
  })

  it('rejects a local page that names this server by a different loopback spelling', () => {
    expect(isRequestAllowed('localhost:3456', 'http://127.0.0.1:3456', LOOPBACK)).toBe(false)
  })

  it('accepts the server\'s own pages on every address it answers on', () => {
    expect(isRequestAllowed('127.0.0.1:3456', 'http://127.0.0.1:3456', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('[::1]:3456', 'http://[::1]:3456', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('192.168.1.20:3456', 'http://192.168.1.20:3456', LAN)).toBe(true)
    expect(isRequestAllowed('LocalHost:3456', 'http://localhost:3456', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('localhost:80', 'http://localhost', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('mymachine.tail1234.ts.net', 'https://mymachine.tail1234.ts.net', LOOPBACK)).toBe(true)
    expect(isRequestAllowed('mymachine.tail1234.ts.net:443', 'https://mymachine.tail1234.ts.net', LOOPBACK)).toBe(true)
  })
})

describe('namesTailscaleHost', () => {
  it('spots a .ts.net Host or Origin so the server can re-read its own name', () => {
    expect(namesTailscaleHost('box.tail1.ts.net', undefined)).toBe(true)
    expect(namesTailscaleHost('localhost:3456', 'https://box.tail1.ts.net')).toBe(true)
    expect(namesTailscaleHost('localhost:3456', 'http://localhost:3456')).toBe(false)
    expect(namesTailscaleHost(undefined, 'null')).toBe(false)
  })
})
