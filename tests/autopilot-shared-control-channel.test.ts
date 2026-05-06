import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeControlChannel } from '../src/main/autopilot-shared/control-channel'

let TMP: string
beforeEach(() => { TMP = mkdtempSync(join(tmpdir(), 'cc-shared-')) })

describe('makeControlChannel', () => {
  const channel = makeControlChannel({ dir: '.autopilot' })

  it('returns null when no marker.json exists', () => {
    expect(channel.readControlMarker(TMP)).toBeNull()
  })

  it('rejects payloads where schemaVersion is missing or wrong', () => {
    mkdirSync(join(TMP, '.autopilot', 'outbox'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot', 'outbox', 'marker.json'),
      JSON.stringify({ id: 'x', kind: 'WAITING' }))
    const r = channel.readControlMarker(TMP)
    expect(r).toEqual({ reason: 'schemaVersion must be 1' })
  })

  it('rejects PROGRESS without subgoalId/status', () => {
    mkdirSync(join(TMP, '.autopilot', 'outbox'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot', 'outbox', 'marker.json'),
      JSON.stringify({ schemaVersion: 1, id: 'x', kind: 'PROGRESS' }))
    const r = channel.readControlMarker(TMP)
    expect(r && 'reason' in r ? r.reason : '').toMatch(/subgoalId/)
  })

  it('writes inbox/reply.txt under the configured dir', () => {
    channel.writeInboxReply(TMP, 'hello')
    const fs = require('fs')
    const txt = fs.readFileSync(join(TMP, '.autopilot', 'inbox', 'reply.txt'), 'utf-8')
    expect(txt).toBe('hello\n')
  })

  it('honours a custom dir', () => {
    const custom = makeControlChannel({ dir: '.custom-pilot' })
    custom.writeInboxReply(TMP, 'hi')
    const fs = require('fs')
    const txt = fs.readFileSync(join(TMP, '.custom-pilot', 'inbox', 'reply.txt'), 'utf-8')
    expect(txt).toBe('hi\n')
  })
})
