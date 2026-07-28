import { describe, expect, it } from 'vitest'
import { isRequestAllowed } from '../src/main/remote-guard'

const LOOPBACK = { lanAccess: false, lanAddresses: ['192.168.1.20'] }
const LAN = { lanAccess: true, lanAddresses: ['192.168.1.20'] }

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
})
