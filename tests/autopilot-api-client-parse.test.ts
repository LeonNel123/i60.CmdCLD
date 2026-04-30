import { describe, it, expect } from 'vitest'
import { parseDecision, parseDebug } from '../src/main/autopilot/api-client'

// These tests pin the contract of the response parsers used by both the
// Anthropic and OpenRouter clients. The orchestrator's correctness depends on
// these functions converting model output strings into typed Decide/DebugResult
// values — when the model returns clean JSON, we route deterministically; when
// it doesn't, we degrade safely (decision → "reply" with the raw text;
// debug → "human" classification). Switching the planner model (Kimi K2,
// DeepSeek, Gemini, etc.) is the primary reason these edge cases matter.

describe('parseDecision', () => {
  describe('happy path', () => {
    it('parses a clean reply object', () => {
      expect(parseDecision('{"kind":"reply","text":"Continue working"}'))
        .toEqual({ kind: 'reply', text: 'Continue working' })
    })

    it('parses reset', () => {
      expect(parseDecision('{"kind":"reset"}')).toEqual({ kind: 'reset' })
    })

    it('parses done with evidence', () => {
      expect(parseDecision('{"kind":"done","evidence":"all tests pass"}'))
        .toEqual({ kind: 'done', evidence: 'all tests pass' })
    })

    it('parses escalate with reason', () => {
      expect(parseDecision('{"kind":"escalate","reason":"goal mis-spec"}'))
        .toEqual({ kind: 'escalate', reason: 'goal mis-spec' })
    })
  })

  describe('markdown fence handling', () => {
    it('strips ```json ... ``` fence', () => {
      const input = '```json\n{"kind":"reply","text":"go"}\n```'
      expect(parseDecision(input)).toEqual({ kind: 'reply', text: 'go' })
    })

    it('strips ``` ... ``` fence without language tag', () => {
      const input = '```\n{"kind":"reply","text":"go"}\n```'
      expect(parseDecision(input)).toEqual({ kind: 'reply', text: 'go' })
    })

    it('case-insensitive on language tag (```JSON)', () => {
      const input = '```JSON\n{"kind":"reset"}\n```'
      expect(parseDecision(input)).toEqual({ kind: 'reset' })
    })

    it('handles whitespace around the fence', () => {
      const input = '\n  ```json\n{"kind":"reply","text":"x"}\n```  \n'
      expect(parseDecision(input)).toEqual({ kind: 'reply', text: 'x' })
    })
  })

  describe('field coercion', () => {
    it('coerces missing reply.text to empty string', () => {
      expect(parseDecision('{"kind":"reply"}'))
        .toEqual({ kind: 'reply', text: '' })
    })

    it('coerces missing done.evidence to empty string', () => {
      expect(parseDecision('{"kind":"done"}'))
        .toEqual({ kind: 'done', evidence: '' })
    })

    it('coerces missing escalate.reason to "unknown"', () => {
      expect(parseDecision('{"kind":"escalate"}'))
        .toEqual({ kind: 'escalate', reason: 'unknown' })
    })

    it('coerces non-string text to string', () => {
      // Some models occasionally emit numbers or booleans — String() coerces.
      expect(parseDecision('{"kind":"reply","text":42}'))
        .toEqual({ kind: 'reply', text: '42' })
    })

    it('preserves unicode and embedded newlines in reply text', () => {
      const r = parseDecision('{"kind":"reply","text":"héllo\\n→ café"}')
      expect(r).toEqual({ kind: 'reply', text: 'héllo\n→ café' })
    })
  })

  describe('safe fallback on bad input', () => {
    it('falls back to reply on malformed JSON', () => {
      const r = parseDecision('{"kind":"reply","text":')  // truncated
      expect(r.kind).toBe('reply')
      if (r.kind === 'reply') expect(r.text).toContain('"kind":"reply"')
    })

    it('falls back to reply on empty string', () => {
      expect(parseDecision('')).toEqual({ kind: 'reply', text: '' })
    })

    it('falls back to reply on whitespace-only input', () => {
      expect(parseDecision('   \n\t  ')).toEqual({ kind: 'reply', text: '' })
    })

    it('falls back to reply on unknown kind value', () => {
      const r = parseDecision('{"kind":"frobulate","text":"???"}')
      expect(r.kind).toBe('reply')
      // Falls through to reply with the raw stripped string preserved
      if (r.kind === 'reply') expect(r.text).toContain('frobulate')
    })

    it('falls back to reply with raw prose if JSON not present', () => {
      // Documented current behaviour: prose without JSON degrades to a reply
      // carrying the prose verbatim. Worst case = the doer reads the prose
      // as instruction; not catastrophic.
      const r = parseDecision('I think you should commit now.')
      expect(r.kind).toBe('reply')
      if (r.kind === 'reply') expect(r.text).toBe('I think you should commit now.')
    })

    it('truncates the malformed-fallback to 1000 chars', () => {
      const long = 'x'.repeat(2000)
      const r = parseDecision(long)
      expect(r.kind).toBe('reply')
      if (r.kind === 'reply') expect(r.text.length).toBe(1000)
    })

    it('rejects null and array roots', () => {
      expect(parseDecision('null').kind).toBe('reply')
      expect(parseDecision('[1,2,3]').kind).toBe('reply')
    })
  })
})

describe('parseDebug', () => {
  describe('happy path', () => {
    it('parses retry with instruction', () => {
      expect(parseDebug('{"kind":"retry","instruction":"run npm i"}'))
        .toEqual({ kind: 'retry', instruction: 'run npm i' })
    })

    it('parses block with reason', () => {
      expect(parseDebug('{"kind":"block","reason":"untestable goal"}'))
        .toEqual({ kind: 'block', reason: 'untestable goal' })
    })

    it('parses human with reason', () => {
      expect(parseDebug('{"kind":"human","reason":"tradeoff"}'))
        .toEqual({ kind: 'human', reason: 'tradeoff' })
    })
  })

  describe('markdown fence handling', () => {
    it('strips ```json ... ``` fence', () => {
      const input = '```json\n{"kind":"retry","instruction":"go"}\n```'
      expect(parseDebug(input)).toEqual({ kind: 'retry', instruction: 'go' })
    })

    it('strips ``` ... ``` fence without language tag', () => {
      const input = '```\n{"kind":"human","reason":"x"}\n```'
      expect(parseDebug(input)).toEqual({ kind: 'human', reason: 'x' })
    })
  })

  describe('field coercion', () => {
    it('coerces missing retry.instruction to empty string', () => {
      expect(parseDebug('{"kind":"retry"}'))
        .toEqual({ kind: 'retry', instruction: '' })
    })

    it('coerces missing block.reason to "unknown"', () => {
      expect(parseDebug('{"kind":"block"}'))
        .toEqual({ kind: 'block', reason: 'unknown' })
    })

    it('coerces missing human.reason to "unknown"', () => {
      expect(parseDebug('{"kind":"human"}'))
        .toEqual({ kind: 'human', reason: 'unknown' })
    })

    it('truncates retry.instruction at 500 chars to bound prompt size', () => {
      const long = 'x'.repeat(1000)
      const r = parseDebug(`{"kind":"retry","instruction":"${long}"}`)
      expect(r.kind).toBe('retry')
      if (r.kind === 'retry') expect(r.instruction.length).toBe(500)
    })
  })

  describe('safe fallback on bad input', () => {
    it('falls back to human on malformed JSON', () => {
      const r = parseDebug('{"kind":"retry","instruction":')
      expect(r.kind).toBe('human')
      if (r.kind === 'human') expect(r.reason).toMatch(/parse failed/i)
    })

    it('falls back to human on empty input', () => {
      const r = parseDebug('')
      expect(r.kind).toBe('human')
      if (r.kind === 'human') expect(r.reason).toMatch(/parse failed/i)
    })

    it('falls back to human on unknown kind value', () => {
      const r = parseDebug('{"kind":"frobulate","reason":"x"}')
      expect(r.kind).toBe('human')
    })

    it('falls back to human on prose without JSON', () => {
      // Same documented behaviour as parseDecision — degraded but safe.
      // For debug the safe default is "human classification" (forces escalation
      // to the user rather than blindly retrying).
      const r = parseDebug('I think you should retry with npm install.')
      expect(r.kind).toBe('human')
    })

    it('rejects null and array roots', () => {
      expect(parseDebug('null').kind).toBe('human')
      expect(parseDebug('[1,2,3]').kind).toBe('human')
    })
  })
})
