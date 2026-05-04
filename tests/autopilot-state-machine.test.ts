import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AutopilotStateMachine } from '../src/main/autopilot/state-machine'
import type { ApiClient, AutopilotOptions, Goal, Milestone, ApiUsage, DecideResult } from '../src/main/autopilot/types'
import { writeGoal, writeMilestone } from '../src/main/autopilot/state-files'

const TMP = join(__dirname, '.tmp-autopilot-sm')

function makeApi(plan: () => DecideResult): ApiClient {
  return {
    decide: vi.fn(async () => ({ result: plan(), usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 50 } as ApiUsage })),
    debug: vi.fn(async () => ({
      result: { kind: 'human' as const, reason: 'unused' },
      usage: { inputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 0 } as ApiUsage,
    })),
    estimateCost: () => 0.001,
  }
}

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('AutopilotStateMachine', () => {
  it('starts in wizard phase when no goal.md exists', async () => {
    const sm = makeSm('idea text', makeApi(() => ({ kind: 'reply', text: 'continue' })))
    await sm.start()
    expect(sm.state.phase).toBe('wizard')
  })

  it('transitions to awaiting_goal_review on GOAL_READY marker', async () => {
    writeGoal(TMP, makeGoal())
    writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForPhase(sm, 'awaiting_goal_review')
    expect(sm.state.phase).toBe('awaiting_goal_review')
  })

  it('approveGoal moves to executing', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForPhase(sm, 'awaiting_goal_review')
    sm.approveGoal()
    expect(sm.state.phase).toBe('executing')
  })

  it('asks the wizard to repair unparsable GOAL_READY files instead of escalating immediately', async () => {
    writeMalformedWizardFiles()
    const writes: string[] = []
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })), writes)
    await sm.start()
    writes.length = 0

    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForFlush()

    expect(sm.state.phase).toBe('wizard')
    expect(sm.state.escalationReason).toBeNull()
    expect(writes.some((w) => w.includes('could not parse') && w.includes('exact Classic format'))).toBe(true)
    expect(writes.some((w) => w.includes('[ORCH:GOAL_READY]'))).toBe(true)
  })

  it('escalates after repeated unparsable GOAL_READY repair attempts', async () => {
    writeMalformedWizardFiles()
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()

    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForFlush()
    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForFlush()
    sm.feedPty('[ORCH:GOAL_READY]\n')
    await waitForPhase(sm, 'escalated')

    expect(sm.state.escalationReason).toMatch(/unparsable after 2 repair prompts/)
  })

  it('escalates on STUCK marker', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.approveGoal()
    sm.feedPty('[ORCH:STUCK] cannot find git\n')
    await waitForPhase(sm, 'escalated')
    expect(sm.state.phase).toBe('escalated')
    // debug call wraps the STUCK reason; makeApi returns kind:'human', reason:'unused'
    expect(sm.state.escalationReason).toMatch(/human|cannot find git/)
  })

  it('updates checklist on PROGRESS done', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
    await sm.start()
    sm.approveGoal()
    sm.feedPty('[ORCH:PROGRESS] m1/s1 done\n')
    await waitForFlush()
    const m = sm.state.milestones.find((mm) => mm.id === 'm1')!
    const s = m.subgoals.find((ss) => ss.id === 's1')!
    expect(s.status).toBe('done')
  })

  it('halts on cost cap', async () => {
    writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
    const expensiveApi: ApiClient = {
      decide: vi.fn(async () => ({ result: { kind: 'reply' as const, text: 'go' }, usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1 } as ApiUsage })),
      debug: vi.fn() as any,
      estimateCost: () => 100, // each call costs $100
    }
    const sm = makeSm('idea', expensiveApi)
    await sm.start()
    sm.approveGoal()
    sm.feedPty('[ORCH:WAITING] q\n')
    await waitForPhase(sm, 'paused')
    expect(sm.state.phase).toBe('paused')
  })
})

function makeSm(idea: string, api: ApiClient, writes?: string[], maxSilenceMs?: number, agentCli?: AutopilotOptions['agentCli']): AutopilotStateMachine {
  const opts: AutopilotOptions = {
    terminalId: 't',
    projectPath: TMP,
    freeTextIdea: idea,
    costCapUsd: 1.0,
    maxIterations: 40,
    apiProvider: 'anthropic',
    apiKey: 'test',
    plannerModel: 'claude-sonnet-4-6',
    writeToPty: (_id, data) => { writes?.push(data) },
    onPtyData: () => () => {},
    onUpdate: () => {},
    runtimeJson: false,
    budgetTracker: false,
  }
  if (agentCli) opts.agentCli = agentCli
  // Default maxSilenceMs to a huge value (24h) so existing tests aren't
  // affected by the silence-escalate guard. Tests that exercise the guard
  // pass a small value explicitly.
  return new AutopilotStateMachine(opts, api, 10, maxSilenceMs ?? 24 * 60 * 60 * 1000)
}

function makeGoal(): Goal {
  return {
    goal: 'X', nonGoals: [], acceptance: [],
    constraints: { maxIterations: 40, maxApiCostUsd: 1.0, maxDoerOutputPerReset: 60000 },
  }
}

function makeMilestone(): Milestone {
  return {
    id: 'm1', name: 'A', status: 'pending', notes: '',
    subgoals: [{ id: 's1', description: 'a', status: 'pending' }],
  }
}

function writeMalformedWizardFiles(): void {
  mkdirSync(join(TMP, '.autopilot', 'milestones'), { recursive: true })
  writeFileSync(join(TMP, '.autopilot', 'goal.md'), [
    '# Goal: Edmore Pool Supplies marketing site',
    '',
    '## Goal statement',
    'Build a marketing site.',
    '',
    '## Acceptance criteria',
    '1. WHEN a user opens the homepage, THE SYSTEM SHALL show pool products.',
    '',
  ].join('\n'))
  writeFileSync(join(TMP, '.autopilot', 'milestones', 'm1.md'), [
    '# Milestone M1: Project scaffold',
    '',
    '## Subgoals',
    '',
    '### s1: Initialise project',
    '- Use npm.',
    '',
  ].join('\n'))
}

async function waitForPhase(sm: AutopilotStateMachine, phase: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (sm.state.phase !== phase) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for phase ${phase}, got ${sm.state.phase}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function waitForFlush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50))
}

it('discovers validation commands on start and exposes them on state', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  writeFileSync(join(TMP, 'package.json'), JSON.stringify({
    scripts: { test: 'vitest run', build: 'tsc -p .' },
  }))
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })))
  await sm.start()
  expect(sm.state.validation.test).toBe('npm test')
  expect(sm.state.validation.build).toBe('npm run build')
})

it('passes learnings into decide() so the planner sees them', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  // Pre-populate a learnings file
  await import('../src/main/autopilot/state-files').then((mod) => {
    mod.appendLearning(TMP, 'remember to run npm install first')
  })
  let captured: any = null
  const api: ApiClient = {
    decide: vi.fn(async (input) => { captured = input; return { result: { kind: 'reply' as const, text: 'ok' }, usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1 } as ApiUsage } }),
    debug: vi.fn(),
    estimateCost: () => 0.001,
  }
  const sm = makeSm('idea', api)
  await sm.start()
  sm.approveGoal()
  sm.feedPty('[ORCH:WAITING] q\n')
  await waitForFlush()
  expect(captured.learnings).toEqual(expect.arrayContaining([expect.stringContaining('npm install first')]))
})

it.each(['claude', 'codex'] as const)('responds to %s carriage-return waiting markers', async (agentCli) => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const writes: string[] = []
  const api = makeApi(() => ({ kind: 'reply', text: 'Proceed with the next step.' }))
  const sm = makeSm('idea', api, writes, undefined, agentCli)
  await sm.start()
  sm.approveGoal()
  writes.length = 0

  sm.feedPty([
    '[ORCH:WAITING]\r',
    'STATUS: waiting\r',
    'QUESTION: Should I continue with the next step?\r',
  ].join(''))
  await waitForFlush()

  expect(api.decide).toHaveBeenCalledTimes(1)
  expect(writes.some((w) => w === 'Proceed with the next step.\r')).toBe(true)
})

it('STUCK marker triggers debug call; on retry stays in executing and types instruction', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const writes: string[] = []
  const api: ApiClient = {
    decide: vi.fn(),
    debug: vi.fn(async () => ({
      result: { kind: 'retry' as const, instruction: 'try npm install first' },
      usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 30 } as ApiUsage,
    })),
    estimateCost: () => 0.0001,
  }
  const sm = makeSm('idea', api, writes)
  await sm.start()
  sm.approveGoal()
  sm.feedPty('[ORCH:STUCK] cannot find npm\n')
  await waitForFlush()
  expect(api.debug).toHaveBeenCalledTimes(1)
  expect(sm.state.phase).toBe('executing')
  expect(writes.some((w) => w.includes('npm install'))).toBe(true)
})

it('STUCK marker with debug result human escalates with reason', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const api: ApiClient = {
    decide: vi.fn(),
    debug: vi.fn(async () => ({
      result: { kind: 'human' as const, reason: 'tradeoff' },
      usage: { inputTokens: 50, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 20 } as ApiUsage,
    })),
    estimateCost: () => 0.0001,
  }
  const sm = makeSm('idea', api)
  await sm.start()
  sm.approveGoal()
  sm.feedPty('[ORCH:STUCK] reason\n')
  await waitForPhase(sm, 'escalated')
  expect(sm.state.phase).toBe('escalated')
  expect(sm.state.escalationReason).toMatch(/tradeoff|reason/)
})

it('partial-streak triggers debug call; on retry stays executing', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const api: ApiClient = {
    decide: vi.fn(async () => ({ result: { kind: 'reply' as const, text: 'go' }, usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1 } as ApiUsage })),
    debug: vi.fn(async () => ({
      result: { kind: 'retry' as const, instruction: 'split the subgoal' },
      usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1 } as ApiUsage,
    })),
    estimateCost: () => 0.0001,
  }
  const sm = makeSm('idea', api)
  await sm.start()
  sm.approveGoal()
  sm.feedPty('[ORCH:PROGRESS] m1/s1 partial\n')
  await waitForFlush()
  sm.feedPty('[ORCH:PROGRESS] m1/s1 partial\n')
  await waitForFlush()
  sm.feedPty('[ORCH:PROGRESS] m1/s1 partial\n')
  await waitForFlush()
  expect(api.debug).toHaveBeenCalledTimes(1)
  expect(sm.state.phase).toBe('executing')
})

it('writes a transcript block per cycle with full doer Q + orchestrator A', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'Run lint, then commit. Use port 8080.' })))
  await sm.start()
  sm.approveGoal()
  sm.feedPty('[ORCH:WAITING] Should I commit now or run the lint first? Also which port?\n')
  await waitForFlush()
  const { readFileSync } = await import('fs')
  const transcript = readFileSync(join(TMP, '.autopilot', 'transcript.md'), 'utf-8')
  expect(transcript).toContain('Cycle 1 — reply')
  expect(transcript).toContain('Should I commit now or run the lint first')
  expect(transcript).toContain('Run lint, then commit. Use port 8080.')
  expect(transcript).toMatch(/cost so far: \$/)
  expect(transcript).toMatch(/model: claude-sonnet-4-6/)
})

it('writes a user-manual transcript block when replyToWaiting is called', async () => {
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'unused' })))
  await sm.start()
  sm.approveGoal()
  sm.replyToWaiting('Use 8080 instead.')
  const { readFileSync } = await import('fs')
  const transcript = readFileSync(join(TMP, '.autopilot', 'transcript.md'), 'utf-8')
  expect(transcript).toContain('User manual reply')
  expect(transcript).toContain('Use 8080 instead.')
})

// ---- silence-escalate guard ----

it('escalates after maxSilenceMs of zero PTY output', async () => {
  vi.useFakeTimers()
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  // 200ms silence cap for the test
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })), undefined, 200)
  await sm.start()
  sm.approveGoal()
  // No data fed — let the silence timer fire
  await vi.advanceTimersByTimeAsync(250)
  expect(sm.state.phase).toBe('escalated')
  expect(sm.state.escalationReason).toMatch(/silent/i)
  vi.useRealTimers()
})

it('does not escalate when data keeps arriving inside the silence window', async () => {
  vi.useFakeTimers()
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })), undefined, 300)
  await sm.start()
  sm.approveGoal()
  // Periodic data well within the 300ms cap — each feed re-arms the timer
  for (let i = 0; i < 5; i++) {
    sm.feedPty('progress: still working\n')
    await vi.advanceTimersByTimeAsync(150)
  }
  // 750ms total elapsed but no single gap exceeded 300ms
  expect(sm.state.phase).not.toBe('escalated')
  vi.useRealTimers()
})

it('clears the silence timer on stop()', async () => {
  vi.useFakeTimers()
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })), undefined, 200)
  await sm.start()
  sm.approveGoal()
  sm.stop()
  // Advance past the silence cap — should NOT escalate because we stopped.
  await vi.advanceTimersByTimeAsync(500)
  expect(sm.state.phase).toBe('stopped')
  vi.useRealTimers()
})

it('clears and re-arms the silence timer across pause/resume', async () => {
  vi.useFakeTimers()
  writeGoal(TMP, makeGoal()); writeMilestone(TMP, makeMilestone())
  const sm = makeSm('idea', makeApi(() => ({ kind: 'reply', text: 'next' })), undefined, 200)
  await sm.start()
  sm.approveGoal()
  sm.pause()
  // While paused, even a long silence shouldn't escalate
  await vi.advanceTimersByTimeAsync(500)
  expect(sm.state.phase).toBe('paused')
  // Resume re-arms; another silence window will then escalate
  sm.resume()
  await vi.advanceTimersByTimeAsync(250)
  expect(sm.state.phase).toBe('escalated')
  vi.useRealTimers()
})

describe('liveStatus + lastMarker (Wave 3.4)', () => {
  it('liveStatus moves through waiting → calling planner → waiting across a cycle', async () => {
    // Set up goal + milestone so the sm starts in executing phase
    mkdirSync(join(TMP, '.autopilot', 'milestones'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot', 'goal.md'),
      '# Goal\n\ntest\n\n## Constraints\n- max_iterations: 40\n- max_api_cost_usd: 1.0\n- max_doer_output_per_reset: 60000\n')
    writeFileSync(join(TMP, '.autopilot', 'milestones', 'm1.md'),
      '# Milestone m1 — first\n\nStatus: in-progress\n\n## Subgoals\n- [ ] s1: do thing\n')

    const stages: (string | null)[] = []
    const opts: AutopilotOptions = {
      terminalId: 't',
      projectPath: TMP,
      freeTextIdea: 'x',
      costCapUsd: 1.0,
      maxIterations: 40,
      apiProvider: 'anthropic',
      apiKey: 'fake',
      plannerModel: 'claude-sonnet-4-6',
      writeToPty: () => {},
      onPtyData: () => () => {},
      onUpdate: (state) => stages.push(state.liveStatus),
    }
    const sm = new AutopilotStateMachine(opts, makeApi(() => ({ kind: 'reply', text: 'continue' })), 10, 24 * 60 * 60 * 1000)
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q?\n')
    await waitForFlush()
    // liveStatus should have transitioned through 'calling planner' at some point
    expect(stages.some((s) => s === 'calling planner')).toBe(true)
    expect(stages[stages.length - 1]).toBe('waiting for doer')
  })

  it('lastMarker is populated after a settle', async () => {
    mkdirSync(join(TMP, '.autopilot', 'milestones'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot', 'goal.md'),
      '# Goal\n\nx\n\n## Constraints\n- max_iterations: 40\n- max_api_cost_usd: 1.0\n- max_doer_output_per_reset: 60000\n')
    writeFileSync(join(TMP, '.autopilot', 'milestones', 'm1.md'),
      '# Milestone m1 — first\n\nStatus: in-progress\n\n## Subgoals\n- [ ] s1: do\n')
    const sm = makeSm('x', makeApi(() => ({ kind: 'reply', text: 'x' })))
    await sm.start()
    sm.feedPty('[ORCH:WAITING] q?\n')
    await waitForFlush()
    expect(sm.state.lastMarker).not.toBeNull()
    expect(sm.state.lastMarker!.kind).toBe('WAITING')
  })
})

describe('permission request handling (Wave 3.6)', () => {
  function setupExecuting() {
    mkdirSync(join(TMP, '.autopilot', 'milestones'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot', 'goal.md'),
      '# Goal\n\nx\n\n## Constraints\n- max_iterations: 40\n- max_api_cost_usd: 1.0\n- max_doer_output_per_reset: 60000\n')
    writeFileSync(join(TMP, '.autopilot', 'milestones', 'm1.md'),
      '# Milestone m1 — first\n\nStatus: in-progress\n\n## Subgoals\n- [ ] s1: do\n')
  }

  async function flush(): Promise<void> {
    await new Promise((r) => setTimeout(r, 50))
  }

  it('state.permissionRequest is set when watcher fires onPermissionPrompt', async () => {
    setupExecuting()
    const sm = makeSm('x', makeApi(() => ({ kind: 'reply', text: 'x' })))
    await sm.start()
    sm.feedPty('Some output\nPermission to run Bash:\n[1] Yes\n[2] No\n')
    await flush()
    expect(sm.state.permissionRequest).not.toBeNull()
    expect(sm.state.permissionRequest!.text).toMatch(/Permission to run/i)
  })

  it('respondToPermission(allow) writes "1\\r" to PTY and clears the field', async () => {
    setupExecuting()
    const writes: string[] = []
    const sm = makeSm('x', makeApi(() => ({ kind: 'reply', text: 'x' })), writes)
    await sm.start()
    sm.feedPty('Permission to run Bash:\n[1] Yes\n[2] No\n')
    await flush()
    expect(sm.state.permissionRequest).not.toBeNull()
    writes.length = 0
    sm.respondToPermission('allow')
    expect(writes.some((w) => w === '1\r')).toBe(true)
    expect(sm.state.permissionRequest).toBeNull()
  })

  it('respondToPermission(deny) writes "3\\r" to PTY and clears the field', async () => {
    setupExecuting()
    const writes: string[] = []
    const sm = makeSm('x', makeApi(() => ({ kind: 'reply', text: 'x' })), writes)
    await sm.start()
    sm.feedPty('Permission to run Bash:\n[1] Yes\n[2] No\n')
    await flush()
    writes.length = 0
    sm.respondToPermission('deny')
    expect(writes.some((w) => w === '3\r')).toBe(true)
    expect(sm.state.permissionRequest).toBeNull()
  })
})
