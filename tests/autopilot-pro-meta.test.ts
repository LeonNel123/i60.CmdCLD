import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { runMetaReflect, parseMetaResponse } from '../src/main/autopilot-pro/meta'
import type { ApiClient, ApiUsage } from '../src/main/autopilot/types'

const TMP = join(__dirname, '.tmp-autopilot-pro-meta')
const PRO = join(TMP, '.autopilot-pro')

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  mkdirSync(PRO, { recursive: true })
})

afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

function fakeMetaClient(response: string): ApiClient {
  return {
    decide: vi.fn(),
    debug: vi.fn(),
    chat: vi.fn(async () => ({
      text: response,
      usage: { inputTokens: 200, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 100 } as ApiUsage,
    })),
    estimateCost: () => 0.002,
  }
}

function setupFiles() {
  writeFileSync(join(PRO, 'spec.md'), '# Spec\n\n## Goal\nbuild a thing\n')
  writeFileSync(join(PRO, 'plan.md'), '# Plan\n\n- [x] T1\n')
  writeFileSync(join(PRO, 'transcript.md'), '## Cycle 1 — reply\n> some Q\n\n> some A\n\n---\n')
  writeFileSync(join(PRO, 'cost.json'), JSON.stringify({ totalUsd: 0.45, capUsd: 1, thresholdsHit: [50] }))
  mkdirSync(join(PRO, 'reviews'), { recursive: true })
  writeFileSync(join(PRO, 'reviews', 'phase1.md'), '# Phase 1 review\n\nAll tests pass.\n')
}

describe('parseMetaResponse', () => {
  it('parses done classification', () => {
    const r = parseMetaResponse('{"classification":"done","summary":"all good"}')
    expect(r.classification).toBe('done')
    expect(r.summary).toBe('all good')
  })

  it('parses extend with draftSpec', () => {
    const r = parseMetaResponse('{"classification":"extend","summary":"add caching","draftSpec":"# Goal\\nadd caching"}')
    expect(r.classification).toBe('extend')
    expect(r.draftSpec).toContain('add caching')
  })

  it('parses human-required with openQuestions', () => {
    const r = parseMetaResponse('{"classification":"human-required","summary":"unclear","openQuestions":["Use SQL or NoSQL?","Sync or async?"]}')
    expect(r.classification).toBe('human-required')
    expect(r.openQuestions).toEqual(['Use SQL or NoSQL?', 'Sync or async?'])
  })

  it('handles markdown fence', () => {
    const r = parseMetaResponse('```json\n{"classification":"done","summary":"ok"}\n```')
    expect(r.classification).toBe('done')
  })

  it('extracts JSON with prose-before', () => {
    const r = parseMetaResponse('My analysis: {"classification":"done","summary":"ok"}')
    expect(r.classification).toBe('done')
  })

  it('falls back to human-required when malformed', () => {
    const r = parseMetaResponse('not json')
    expect(r.classification).toBe('human-required')
    expect(r.summary).toMatch(/unparseable|failed/i)
  })

  it('rejects unknown classification', () => {
    const r = parseMetaResponse('{"classification":"maybe","summary":"x"}')
    expect(r.classification).toBe('human-required')
  })

  it('coerces missing draftSpec for extend to placeholder', () => {
    const r = parseMetaResponse('{"classification":"extend","summary":"x"}')
    expect(r.classification).toBe('extend')
    expect(r.draftSpec).toBe('(draft missing)')
  })

  it('coerces missing openQuestions to empty array', () => {
    const r = parseMetaResponse('{"classification":"human-required","summary":"x"}')
    expect(r.openQuestions).toEqual([])
  })
})

describe('runMetaReflect', () => {
  it('writes final-summary.md on done classification', async () => {
    setupFiles()
    const client = fakeMetaClient('{"classification":"done","summary":"spec satisfied; reviews clean"}')
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('done')
    expect(existsSync(join(PRO, 'final-summary.md'))).toBe(true)
    const content = readFileSync(join(PRO, 'final-summary.md'), 'utf-8')
    expect(content).toContain('done')
    expect(content).toContain('spec satisfied')
    expect(content).toContain('$0.4500')
  })

  it('writes next-spec-draft.md on extend classification', async () => {
    setupFiles()
    const draft = '# Goal\n\nAdd OAuth flow.\n\n## Non-goals\n- ...'
    const client = fakeMetaClient(JSON.stringify({
      classification: 'extend',
      summary: 'auth gap surfaced',
      draftSpec: draft,
    }))
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('extend')
    expect(existsSync(join(PRO, 'next-spec-draft.md'))).toBe(true)
    expect(readFileSync(join(PRO, 'next-spec-draft.md'), 'utf-8')).toBe(draft)
  })

  it('writes escalation-summary.md on human-required classification', async () => {
    setupFiles()
    const client = fakeMetaClient(JSON.stringify({
      classification: 'human-required',
      summary: 'architecture choice surfaced',
      openQuestions: ['SQL or NoSQL?', 'Sync or async?'],
    }))
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('human-required')
    expect(existsSync(join(PRO, 'escalation-summary.md'))).toBe(true)
    const content = readFileSync(join(PRO, 'escalation-summary.md'), 'utf-8')
    expect(content).toContain('SQL or NoSQL?')
    expect(content).toContain('Sync or async?')
  })

  it('falls back to done summary on API error', async () => {
    setupFiles()
    const client: ApiClient = {
      decide: vi.fn(),
      debug: vi.fn(),
      chat: vi.fn(async () => { throw new Error('rate limit') }),
      estimateCost: () => 0,
    }
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('done')
    expect(r.summary).toMatch(/skipped|rate limit/)
    expect(existsSync(join(PRO, 'final-summary.md'))).toBe(true)
  })

  it('throws when client.chat is missing', async () => {
    setupFiles()
    const client: ApiClient = { decide: vi.fn(), debug: vi.fn(), estimateCost: () => 0 }
    await expect(runMetaReflect(client, TMP)).rejects.toThrow(/chat/i)
  })

  it('handles missing input files gracefully (no spec.md / plan.md)', async () => {
    // PRO dir exists but no artifacts.
    const client = fakeMetaClient('{"classification":"done","summary":"empty run"}')
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('done')
  })
})

describe('runMetaReflect + state-machine auto-fire integration', () => {
  it('runMetaReflect can be called by state machine without manual IPC', async () => {
    setupFiles()
    const client = fakeMetaClient('{"classification":"done","summary":"ok"}')
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('done')
    expect(existsSync(join(PRO, 'final-summary.md'))).toBe(true)
  })

  it('runMetaReflect tolerates absent reviews dir (single-phase plan)', async () => {
    writeFileSync(join(PRO, 'spec.md'), '# spec')
    writeFileSync(join(PRO, 'plan.md'), '# plan')
    const client = fakeMetaClient('{"classification":"done","summary":"ok"}')
    const r = await runMetaReflect(client, TMP)
    expect(r.classification).toBe('done')
  })
})
