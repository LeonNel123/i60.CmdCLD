import { describe, expect, it, vi } from 'vitest'
import { buildCouncilReviewerPrompt } from '../src/main/autopilot-council/prompts'
import { CouncilReviewerSession } from '../src/main/autopilot-council/reviewer-session'

const APPROVE_JSON = '{"verdict":"approve","risk":"low","findings":[],"recommended_instruction":"","rationale":"ok"}'
const REFINE_JSON = '{"verdict":"refine","risk":"medium","findings":[],"recommended_instruction":"fix it","rationale":"needs work"}'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('CouncilReviewerSession', () => {
  it('sends reviewer system prompt before packet and attaches one listener', async () => {
    const writes: string[] = []
    let listener: ((data: string) => void) | null = null
    const onPtyData = vi.fn((_id: string, cb: (data: string) => void) => {
      listener = cb
      return () => {}
    })
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'claude',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData,
      timeoutMs: 100,
    })

    await session.start()
    await session.start()
    const pending = session.review('# Packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(APPROVE_JSON)
    await pending

    expect(onPtyData).toHaveBeenCalledTimes(1)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toBe(buildCouncilReviewerPrompt('claude') + '\r')
    expect(writes[1]).toBe('# Packet\r')
  })

  it('parses reviewer JSON from noisy output', async () => {
    let listener: ((data: string) => void) | null = null
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: vi.fn(),
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 1000,
    })

    const pending = session.review('# Packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(`thinking...\n${APPROVE_JSON}\ndone`)
    const result = await pending

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') {
      expect(result.decision.verdict).toBe('approve')
      expect(result.raw).toContain(APPROVE_JSON)
    }
  })

  it('times out when reviewer does not answer', async () => {
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'claude',
      writeToPty: vi.fn(),
      onPtyData: () => () => {},
      timeoutMs: 5,
    })

    const result = await session.review('# Packet')

    expect(result).toEqual({ kind: 'timeout', raw: '' })
  })

  it('returns invalid output when reviewer responds without valid JSON', async () => {
    let listener: ((data: string) => void) | null = null
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'claude',
      writeToPty: vi.fn(),
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 5,
    })

    const pending = session.review('# Packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current('I think this needs changes, but I will not send JSON.')
    const result = await pending

    expect(result.kind).toBe('invalid')
    if (result.kind === 'invalid') {
      expect(result.raw).toContain('needs changes')
      expect(result.error).toBeTruthy()
    }
  })

  it('reattaches and resends prompt after stop while stop remains idempotent', async () => {
    const writes: string[] = []
    const detach = vi.fn()
    const onPtyData = vi.fn((_id: string, _cb: (data: string) => void) => detach)
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData,
      timeoutMs: 100,
    })

    await session.start()
    session.stop()
    session.stop()
    await session.start()

    expect(onPtyData).toHaveBeenCalledTimes(2)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([
      buildCouncilReviewerPrompt('codex') + '\r',
      buildCouncilReviewerPrompt('codex') + '\r',
    ])
  })

  it('does not parse stale prompt output as the current review response', async () => {
    let listener: ((data: string) => void) | null = null
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'claude',
      writeToPty: vi.fn(),
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 100,
    })

    await session.start()
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(buildCouncilReviewerPrompt('claude'))

    const pending = session.review('# Packet')
    await sleep(10)
    current(APPROVE_JSON)
    const result = await pending

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') expect(result.decision.verdict).toBe('approve')
  })

  it('does not reuse prior review output for a later packet', async () => {
    let listener: ((data: string) => void) | null = null
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: vi.fn(),
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 5,
    })

    const first = session.review('# First packet')
    let current = listener
    if (current === null) throw new Error('listener was not attached')
    current(REFINE_JSON)
    const firstResult = await first
    expect(firstResult.kind).toBe('decision')

    const secondResult = await session.review('# Second packet')

    expect(secondResult).toEqual({ kind: 'timeout', raw: '' })
  })
})
