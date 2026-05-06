import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readProControlMarker, writeProInboxReply } from '../src/main/autopilot-pro/control-channel'

let TMP: string
beforeEach(() => { TMP = mkdtempSync(join(tmpdir(), 'cc-pro-')) })

function dropMarker(obj: unknown): void {
  mkdirSync(join(TMP, '.autopilot-pro', 'outbox'), { recursive: true })
  writeFileSync(join(TMP, '.autopilot-pro', 'outbox', 'marker.json'), JSON.stringify(obj))
}

describe('readProControlMarker', () => {
  it('returns null when nothing is on disk', () => {
    expect(readProControlMarker(TMP)).toBeNull()
  })

  it('parses a base WAITING marker', () => {
    dropMarker({ schemaVersion: 1, id: 'a1', kind: 'WAITING', text: 'go?', question: 'go?' })
    const r = readProControlMarker(TMP)
    expect(r && 'marker' in r ? r.marker.kind : null).toBe('WAITING')
  })

  it('parses PRO-specific fields when present', () => {
    dropMarker({
      schemaVersion: 1, id: 'a2', kind: 'WAITING',
      shape: 'approve', artifactPath: 'spec.md',
      proStatus: 'spec-update-request', delta: 'add /v1/cancel',
      subagentEtaMin: 12,
      options: ['A: x', 'B: y'],
      assumption: 'Stripe v2024-01 supports refunds',
      researchTopics: [{ slug: 'oauth', query: 'how does X auth?' }],
      optionsRationale: [{ option: 'A', pros: ['p'], cons: ['c'] }],
      researchTopic: 'oauth',
      researchForce: false,
    })
    const r = readProControlMarker(TMP)
    if (!r || 'reason' in r) throw new Error('expected success')
    expect(r.marker.shape).toBe('approve')
    expect(r.marker.artifactPath).toBe('spec.md')
    expect(r.marker.proStatus).toBe('spec-update-request')
    expect(r.marker.delta).toBe('add /v1/cancel')
    expect(r.marker.subagentEtaMin).toBe(12)
    expect(r.marker.options).toEqual(['A: x', 'B: y'])
    expect(r.marker.assumption).toMatch(/Stripe/)
    expect(r.marker.researchTopics?.[0]?.slug).toBe('oauth')
    expect(r.marker.optionsRationale?.[0]?.option).toBe('A')
    expect(r.marker.researchTopic).toBe('oauth')
    expect(r.marker.researchForce).toBe(false)
  })

  it('rejects unknown DECISION_SHAPE values', () => {
    dropMarker({ schemaVersion: 1, id: 'a3', kind: 'WAITING', shape: 'wat' })
    const r = readProControlMarker(TMP)
    expect(r && 'reason' in r ? r.reason : '').toMatch(/shape/)
  })

  it('writes inbox/reply.txt under .autopilot-pro', () => {
    writeProInboxReply(TMP, 'next')
    const txt = readFileSync(join(TMP, '.autopilot-pro', 'inbox', 'reply.txt'), 'utf-8')
    expect(txt).toBe('next\n')
  })
})
