import { describe, expect, it } from 'vitest'
import {
  BROADCAST_REFINE_SYSTEM_PROMPT,
  buildRefineUserMessage,
  selectBroadcastTargets,
} from '../src/shared/broadcast'

describe('selectBroadcastTargets', () => {
  it('excludes plain shells and labels agent consoles by CLI', () => {
    const targets = selectBroadcastTargets([
      { id: 'a', name: 'proj', agentCli: 'claude' },
      { id: 'b', name: 'proj', agentCli: 'codex' },
      { id: 'c', name: 'proj', agentCli: 'grok' },
      { id: 'd', name: 'proj', isPlainShell: true },
    ])
    expect(targets.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(targets.map((t) => t.label)).toEqual(['proj (Claude)', 'proj (Codex)', 'proj (Grok)'])
    expect(targets.map((t) => t.agentCli)).toEqual(['claude', 'codex', 'grok'])
  })

  it('normalises unknown or missing agentCli to Claude', () => {
    const targets = selectBroadcastTargets([
      { id: 'a', name: 'x' },
      { id: 'b', name: 'y', agentCli: 'nonsense' },
    ])
    expect(targets.map((t) => t.label)).toEqual(['x (Claude)', 'y (Claude)'])
  })

  it('returns an empty list when only shells are open', () => {
    expect(selectBroadcastTargets([{ id: 'a', name: 'x', isPlainShell: true }])).toEqual([])
  })
})

describe('buildRefineUserMessage', () => {
  it('mentions the targets and trims the raw prompt', () => {
    const msg = buildRefineUserMessage('  fix the login bug  \n', ['proj (Claude)', 'proj (Codex)'])
    expect(msg).toBe('The prompt will be sent to: proj (Claude), proj (Codex).\n\nRewrite this prompt:\n\nfix the login bug')
  })

  it('omits the targets line when none are given', () => {
    expect(buildRefineUserMessage('do x', [])).toBe('Rewrite this prompt:\n\ndo x')
  })
})

describe('BROADCAST_REFINE_SYSTEM_PROMPT', () => {
  it('instructs the model to output only the rewritten prompt', () => {
    expect(BROADCAST_REFINE_SYSTEM_PROMPT).toContain('ONLY the rewritten prompt')
    expect(BROADCAST_REFINE_SYSTEM_PROMPT).toMatch(/preserve/i)
  })
})
