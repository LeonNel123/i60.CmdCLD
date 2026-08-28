import { describe, expect, it } from 'vitest'
import { estimateCostFor } from '../src/main/autopilot/api-client'

// Prices verified against the live OpenRouter catalogue on 2026-08-19. Several older
// entries had drifted from their published rates, which matters because the cost cap
// pauses Autopilot on these numbers.
const oneMillionEach = {
  inputTokens: 1_000_000,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 1_000_000,
}

describe('refreshed model rates', () => {
  const cases: Array<[string, number]> = [
    ['nvidia/nemotron-3.5-lightning', 0.08 + 0.20],
    ['qwen/qwen3.7-flash', 0.03 + 0.13],
    ['deepseek/deepseek-v4-flash', 0.08 + 0.16],
    ['openai/gpt-5.6-luna', 0.20 + 1.20],
    ['google/gemini-3.1-flash-lite', 0.25 + 1.50],
    ['google/gemini-3.7-flash', 0.38 + 1.88],
    ['moonshotai/kimi-k2.6', 0.95 + 4.00],
    ['deepseek/deepseek-v4-pro', 0.87 + 1.74],
    ['z-ai/glm-5.3', 1.40 + 4.40],
    ['x-ai/grok-4.6', 2.00 + 6.00],
  ]
  for (const [id, expected] of cases) {
    it(`prices ${id} from the table, not the fallback`, () => {
      expect(estimateCostFor(id, oneMillionEach)).toBeCloseTo(expected, 5)
    })
  }

  // The fallback is deliberately high so an unrecognised id pauses the run early
  // rather than overspending. Any model we ship in the picker must NOT hit it.
  it('keeps the conservative fallback for genuinely unknown ids', () => {
    expect(estimateCostFor('who/knows', oneMillionEach)).toBeCloseTo(25, 5)
  })
})
