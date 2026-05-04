import { describe, expect, it, vi } from 'vitest'
import { buildCouncilReviewerPrompt } from '../src/main/autopilot-council/prompts'
import { CouncilReviewerSession } from '../src/main/autopilot-council/reviewer-session'

const APPROVE_JSON = '{"verdict":"approve","risk":"low","findings":[],"recommended_instruction":"","rationale":"ok"}'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function reviewerJson(requestId: string, verdict: 'approve' | 'refine' = 'approve'): string {
  return JSON.stringify({
    request_id: requestId,
    verdict,
    risk: verdict === 'approve' ? 'low' : 'medium',
    findings: [],
    recommended_instruction: verdict === 'approve' ? '' : 'fix it',
    rationale: verdict === 'approve' ? 'ok' : 'needs work',
  })
}

function extractRequestId(packetWrite: string): string {
  const match = packetWrite.match(/^Council Review Request ID: ([^\r\n]+)/m)
  if (match === null) throw new Error(`missing review request id in packet write: ${packetWrite}`)
  return match[1].trim()
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
    current(reviewerJson(extractRequestId(writes[1])))
    await pending

    expect(onPtyData).toHaveBeenCalledTimes(1)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toBe(buildCouncilReviewerPrompt('claude') + '\r')
    expect(writes[1]).toContain('# Packet')
    expect(writes[1]).toContain('Council Review Request ID:')
    expect(writes[1]).toContain('"request_id"')
  })

  it('parses reviewer JSON with the current request id from noisy output', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 1000,
    })

    const pending = session.review('# Packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(`thinking...\n${reviewerJson(extractRequestId(writes[1]))}\ndone`)
    const result = await pending

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') {
      expect(result.decision.verdict).toBe('approve')
      expect(result.raw).toContain('"request_id"')
    }
  })

  it('accepts a valid current response with matching request id', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 1000,
    })

    const pending = session.review('# Packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(reviewerJson(extractRequestId(writes[1]), 'refine'))
    const result = await pending

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') expect(result.decision.verdict).toBe('refine')
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

  it('times out when reviewer output has no current JSON response', async () => {
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

    expect(result.kind).toBe('timeout')
    expect(result.raw).toContain('needs changes')
  })

  it('times out on chunked packet echo with no reviewer JSON response', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 5,
    })

    const pending = session.review('# Packet\n```diff\n+ if (ready) {\n+   runReview()\n```')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(writes[1].slice(0, 40))
    current(writes[1].slice(40))
    const result = await pending

    expect(result.kind).toBe('timeout')
    expect(result.raw).toContain('runReview')
  })

  it('times out on split late old JSON during a new review', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 5,
    })

    const first = await session.review('# First packet')
    expect(first.kind).toBe('timeout')
    const oldResponse = reviewerJson(extractRequestId(writes[1]), 'refine')

    const second = session.review('# Second packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(oldResponse.slice(0, 30))
    current(oldResponse.slice(30))
    const result = await second

    expect(result.kind).toBe('timeout')
    expect(result.raw).toContain('"request_id"')
  })

  it('returns invalid for malformed current response with matching request id', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 5,
    })

    const pending = session.review('# Packet')
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(JSON.stringify({
      request_id: extractRequestId(writes[1]),
      verdict: 'block',
      risk: 'low',
      findings: [],
      recommended_instruction: '',
      rationale: '',
    }))
    const result = await pending

    expect(result.kind).toBe('invalid')
    if (result.kind === 'invalid') {
      expect(result.error).toContain('verdict')
      expect(result.raw).toContain('"request_id"')
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

  it('does not accept prompt example echo after review starts', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'claude',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 1000,
    })

    await session.start()
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(buildCouncilReviewerPrompt('claude'))

    const pending = session.review('# Packet')
    let settled = false
    pending.then(() => { settled = true }, () => { settled = true })
    current(APPROVE_JSON)
    await sleep(10)
    expect(settled).toBe(false)
    current(reviewerJson(extractRequestId(writes[1])))
    const result = await pending

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') expect(result.decision.verdict).toBe('approve')
  })

  it('does not accept packet echo containing reviewer-shaped JSON', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 1000,
    })

    const pending = session.review(`# Packet\n${APPROVE_JSON}`)
    let settled = false
    pending.then(() => { settled = true }, () => { settled = true })
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(writes[1])
    await sleep(10)
    expect(settled).toBe(false)
    current(reviewerJson(extractRequestId(writes[1])))
    const result = await pending

    expect(result.kind).toBe('decision')
  })

  it('does not reuse prior review output for a later packet', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 5,
    })

    const first = session.review('# First packet')
    let current = listener
    if (current === null) throw new Error('listener was not attached')
    current(reviewerJson(extractRequestId(writes[1]), 'refine'))
    const firstResult = await first
    expect(firstResult.kind).toBe('decision')

    const secondResult = await session.review('# Second packet')

    expect(secondResult).toEqual({ kind: 'timeout', raw: '' })
  })

  it('does not accept late output from a timed-out old review in the next review', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 50,
    })

    const first = await session.review('# First packet')
    expect(first.kind).toBe('timeout')
    const oldRequestId = extractRequestId(writes[1])

    const second = session.review('# Second packet')
    let settled = false
    second.then(() => { settled = true }, () => { settled = true })
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(reviewerJson(oldRequestId, 'refine'))
    await sleep(10)
    expect(settled).toBe(false)
    current(reviewerJson(extractRequestId(writes[2])))
    const result = await second

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') expect(result.decision.verdict).toBe('approve')
  })

  it('does not accept late output from a stopped old review in a restarted session', async () => {
    let listener: ((data: string) => void) | null = null
    const writes: string[] = []
    const session = new CouncilReviewerSession({
      terminalId: 'reviewer',
      reviewerCli: 'codex',
      writeToPty: (_id, data) => { writes.push(data) },
      onPtyData: (_id, cb) => {
        listener = cb
        return () => {}
      },
      timeoutMs: 1000,
    })

    const first = session.review('# First packet')
    const oldRequestId = extractRequestId(writes[1])
    session.stop()
    expect(await first).toEqual({ kind: 'timeout', raw: '' })

    const second = session.review('# Second packet')
    let settled = false
    second.then(() => { settled = true }, () => { settled = true })
    const current = listener
    if (current === null) throw new Error('listener was not attached')
    current(reviewerJson(oldRequestId, 'refine'))
    await sleep(10)
    expect(settled).toBe(false)
    current(reviewerJson(extractRequestId(writes[3])))
    const result = await second

    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') expect(result.decision.verdict).toBe('approve')
  })
})
