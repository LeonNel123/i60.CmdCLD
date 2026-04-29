import { describe, it, expect, vi } from 'vitest'
import { runResetSequence } from '../src/main/autopilot/reset'

describe('runResetSequence', () => {
  it('sends summarise → /clear → system prompt → resume in order', async () => {
    const sent: string[] = []
    const writeToPty = (s: string) => sent.push(s)
    const wait = vi.fn(async () => {})

    await runResetSequence({
      writeToPty,
      waitForSettle: wait,
      currentMilestoneId: 'm2',
    })

    expect(sent.length).toBe(4)
    expect(sent[0]).toContain('clear summary of the')
    expect(sent[1]).toBe('/clear\r')
    expect(sent[2]).toContain('You are operating under an autonomous orchestrator')
    expect(sent[3]).toContain('Resume autopilot work')
    expect(sent[3]).toContain('m2')
    expect(wait).toHaveBeenCalledTimes(2) // after summarise and after /clear
  })
})
