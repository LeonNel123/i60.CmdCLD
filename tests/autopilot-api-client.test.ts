import { describe, it, expect } from 'vitest'
import { estimateCostFor, OpenRouterClient, AnthropicClient } from '../src/main/autopilot/api-client'
import type { ApiUsage } from '../src/main/autopilot/types'

const usage: ApiUsage = {
  inputTokens: 1_000_000,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 1_000_000,
}

describe('estimateCostFor', () => {
  it('uses Kimi K2 0905 rates when given that model id', () => {
    // 1M input @ $0.40 + 1M output @ $2.00 = $2.40
    expect(estimateCostFor('moonshotai/kimi-k2-0905', usage)).toBeCloseTo(2.40, 5)
  })

  it('uses Gemini 2.5 Flash rates', () => {
    // 1M input @ $0.30 + 1M output @ $2.50 = $2.80
    expect(estimateCostFor('google/gemini-2.5-flash', usage)).toBeCloseTo(2.80, 5)
  })

  it('uses Sonnet 4.6 rates for the legacy plain name', () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(estimateCostFor('claude-sonnet-4-6', usage)).toBeCloseTo(18, 5)
  })

  it('falls back to openrouter-default for an unknown provider/model id', () => {
    // 1M input @ $5 + 1M output @ $20 = $25
    expect(estimateCostFor('unknown-vendor/unknown-model', usage)).toBeCloseTo(25, 5)
  })

  it('falls back to Sonnet 4.6 for an unknown plain name (no slash)', () => {
    expect(estimateCostFor('claude-not-a-real-model', usage)).toBeCloseTo(18, 5)
  })
})

describe('OpenRouterClient.estimateCost', () => {
  it('honours the constructor model id rather than openrouter-default', () => {
    const client = new OpenRouterClient('fake-key', 'moonshotai/kimi-k2-0905')
    // Same usage shape: 1M input + 1M output. Kimi 0905 => $2.40, NOT the
    // old openrouter-default $25.
    expect(client.estimateCost(usage)).toBeCloseTo(2.40, 5)
  })

  it('falls back to openrouter-default when the model is unknown', () => {
    const client = new OpenRouterClient('fake-key', 'mystery/model-x')
    expect(client.estimateCost(usage)).toBeCloseTo(25, 5)
  })
})

describe('AnthropicClient.estimateCost', () => {
  it('still uses its own model id (Sonnet by default)', () => {
    const client = new AnthropicClient('fake-key', 'claude-sonnet-4-6')
    expect(client.estimateCost(usage)).toBeCloseTo(18, 5)
  })

  it('uses Haiku rates when constructed with Haiku', () => {
    const client = new AnthropicClient('fake-key', 'claude-haiku-4-5')
    // 1M input @ $1 + 1M output @ $5 = $6
    expect(client.estimateCost(usage)).toBeCloseTo(6, 5)
  })
})
