import { describe, it, expect } from 'vitest'
import { inspectAutopilotOutput } from '../src/main/autopilot/output-inspector'

describe('inspectAutopilotOutput', () => {
  it('reports the latest parser-visible marker and a clean output tail', () => {
    const result = inspectAutopilotOutput([
      '\x1b[31mWorking\x1b[0m\r\n',
      '[ORCH:WAITING]\r\n',
      'STATUS: waiting\r\n',
      'DECISION_SHAPE: approve\r\n',
      'ARTIFACT: .autopilot-pro/spec.md\r\n',
      'QUESTION: Approve the spec?\r\n',
    ].join(''))

    expect(result.marker?.kind).toBe('WAITING')
    expect(result.marker?.question).toBe('Approve the spec?')
    expect(result.structuredFields).toMatchObject({
      STATUS: 'waiting',
      DECISION_SHAPE: 'approve',
      ARTIFACT: '.autopilot-pro/spec.md',
    })
    expect(result.cleanTail).not.toContain('\x1b')
  })

  it('explains when no marker is visible to the parser', () => {
    const result = inspectAutopilotOutput('Agent finished but did not emit a protocol tag.')

    expect(result.marker).toBeNull()
    expect(result.summary).toMatch(/No parser-visible/i)
  })

  it('reports Codex bullet-prefixed markers and indented structured fields', () => {
    const result = inspectAutopilotOutput([
      '• [ORCH:WAITING]\r\n',
      '  STATUS: waiting\r\n',
      '  DECISION_SHAPE: reply\r\n',
      '  QUESTION: live codex pty marker test complete\r\n',
    ].join(''))

    expect(result.marker?.kind).toBe('WAITING')
    expect(result.marker?.question).toBe('live codex pty marker test complete')
    expect(result.structuredFields).toMatchObject({
      STATUS: 'waiting',
      DECISION_SHAPE: 'reply',
      QUESTION: 'live codex pty marker test complete',
    })
  })

  it('reports Claude-compressed structured fields', () => {
    const result = inspectAutopilotOutput([
      '●[ORCH:WAITING]  STATUS:waiting\r\n',
      '  DECISION_SHAPE: reply  QUESTION: live claude pty marker test complete\r\n',
    ].join(''))

    expect(result.marker?.kind).toBe('WAITING')
    expect(result.marker?.question).toBe('live claude pty marker test complete')
    expect(result.structuredFields).toMatchObject({
      STATUS: 'waiting',
      DECISION_SHAPE: 'reply',
      QUESTION: 'live claude pty marker test complete',
    })
  })
})
