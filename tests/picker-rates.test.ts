import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { estimateCostFor } from '../src/main/autopilot/api-client'

// Every model offered in the settings pickers must have a real entry in RATES.
// A missing one silently falls through to openrouter-default ($5/$20), which does not
// error - it just overstates spend and pauses Autopilot early on the cost cap. That is
// exactly the kind of drift that goes unnoticed, so it is pinned here.
const settingsDir = join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'settings')
const pane = readFileSync(join(settingsDir, 'AutopilotPane.tsx'), 'utf-8')
// The refine picks live in the Broadcast pane; this test follows them rather than
// silently covering nothing when they move.
const broadcastPane = readFileSync(join(settingsDir, 'BroadcastPane.tsx'), 'utf-8')

function idsFrom(block: string): string[] {
  return [...block.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1])
}

const openrouterBlock = pane.slice(pane.indexOf('  openrouter: ['), pane.indexOf('} as const'))
const refineBlock = broadcastPane.slice(broadcastPane.indexOf('const REFINE_PICKS = ['), broadcastPane.indexOf('] as const'))

const FALLBACK = 25 // 1M in + 1M out at the openrouter-default rate
const oneMillionEach = { inputTokens: 1_000_000, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1_000_000 }

describe('settings picker options are priced', () => {
  it('finds the option lists', () => {
    expect(idsFrom(openrouterBlock).length).toBeGreaterThan(10)
    expect(idsFrom(refineBlock).length).toBeGreaterThan(5)
  })

  for (const id of idsFrom(openrouterBlock)) {
    it(`planner option ${id} has a rate`, () => {
      expect(estimateCostFor(id, oneMillionEach)).not.toBeCloseTo(FALLBACK, 5)
    })
  }

  for (const id of idsFrom(refineBlock)) {
    it(`refine option ${id} has a rate`, () => {
      // Anthropic ids resolve through their own entries, OpenRouter ids through theirs.
      expect(estimateCostFor(id, oneMillionEach)).not.toBeCloseTo(FALLBACK, 5)
    })
  }
})
