import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readCouncilControlMarker, writeCouncilInboxReply } from '../src/main/autopilot-council/control-channel'

let TMP: string
beforeEach(() => { TMP = mkdtempSync(join(tmpdir(), 'cc-council-')) })

describe('readCouncilControlMarker', () => {
  it('reads from .autopilot-council/outbox/marker.json', () => {
    mkdirSync(join(TMP, '.autopilot-council', 'outbox'), { recursive: true })
    writeFileSync(
      join(TMP, '.autopilot-council', 'outbox', 'marker.json'),
      JSON.stringify({ schemaVersion: 1, id: 'c1', kind: 'WAITING', shape: 'reply', text: 'go?' }),
    )
    const r = readCouncilControlMarker(TMP)
    if (!r || 'reason' in r) throw new Error('expected success')
    expect(r.marker.kind).toBe('WAITING')
    expect(r.marker.shape).toBe('reply')
  })

  it('does not read from .autopilot-pro/outbox/marker.json', () => {
    mkdirSync(join(TMP, '.autopilot-pro', 'outbox'), { recursive: true })
    writeFileSync(
      join(TMP, '.autopilot-pro', 'outbox', 'marker.json'),
      JSON.stringify({ schemaVersion: 1, id: 'p1', kind: 'WAITING', shape: 'reply', text: 'go?' }),
    )
    expect(readCouncilControlMarker(TMP)).toBeNull()
  })

  it('writes inbox/reply.txt under .autopilot-council', () => {
    writeCouncilInboxReply(TMP, 'go')
    const txt = readFileSync(join(TMP, '.autopilot-council', 'inbox', 'reply.txt'), 'utf-8')
    expect(txt).toBe('go\n')
  })
})
