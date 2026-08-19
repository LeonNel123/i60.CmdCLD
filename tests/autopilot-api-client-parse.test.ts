import { describe, it, expect } from 'vitest'
import {
  assertUsableText,
  extractText,
  MAX_TOKENS_CHAT,
  MAX_TOKENS_DEBUG,
  MAX_TOKENS_DECIDE,
  parseDecision,
  parseDebug,
} from '../src/main/autopilot/api-client'

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

  describe('embedded JSON recovery (prose-before / prose-after)', () => {
    it('extracts JSON when prose precedes it', () => {
      const r = parseDecision('Sure, here is my decision: {"kind":"reply","text":"go"}')
      expect(r).toEqual({ kind: 'reply', text: 'go' })
    })

    it('extracts JSON when prose follows it', () => {
      const r = parseDecision('{"kind":"reply","text":"go"} (and that\'s my answer)')
      expect(r).toEqual({ kind: 'reply', text: 'go' })
    })

    it('extracts JSON sandwiched between prose blocks', () => {
      const r = parseDecision('Analysis:\n\n{"kind":"reset"}\n\nDone.')
      expect(r).toEqual({ kind: 'reset' })
    })

    it('handles braces inside strings without confusing the brace-matcher', () => {
      const r = parseDecision('Note: {"kind":"reply","text":"use {brace} here"}')
      expect(r).toEqual({ kind: 'reply', text: 'use {brace} here' })
    })

    it('handles escaped quotes inside strings', () => {
      const r = parseDecision('{"kind":"reply","text":"say \\"hi\\""}')
      expect(r).toEqual({ kind: 'reply', text: 'say "hi"' })
    })

    it('handles nested objects (picks the outer balanced block)', () => {
      const r = parseDecision('{"kind":"reply","text":"x","extra":{"a":1,"b":[2,3]}}')
      expect(r).toEqual({ kind: 'reply', text: 'x' })
    })

    it('extracts JSON from inside a markdown fence even with leading prose', () => {
      const r = parseDecision('Here:\n```json\n{"kind":"done","evidence":"all green"}\n```')
      expect(r).toEqual({ kind: 'done', evidence: 'all green' })
    })

    it('still falls back to prose-as-reply when no balanced object exists', () => {
      // Pure prose, no JSON at all → safe fallback unchanged.
      const r = parseDecision('I think you should commit now.')
      expect(r).toEqual({ kind: 'reply', text: 'I think you should commit now.' })
    })

    it('falls back when prose contains an opening { but no matching close', () => {
      // Truncated/unbalanced — extractor returns null, safe fallback fires.
      const r = parseDecision('Maybe {"kind":"reply", oops')
      expect(r.kind).toBe('reply')
      if (r.kind === 'reply') expect(r.text).toContain('Maybe')
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

  describe('embedded JSON recovery (prose-before / prose-after)', () => {
    it('extracts retry from prose-before-JSON', () => {
      const r = parseDebug('My analysis: {"kind":"retry","instruction":"npm i"}')
      expect(r).toEqual({ kind: 'retry', instruction: 'npm i' })
    })

    it('extracts block from prose-after-JSON', () => {
      const r = parseDebug('{"kind":"block","reason":"untestable"} — escalating now.')
      expect(r).toEqual({ kind: 'block', reason: 'untestable' })
    })

    it('handles braces inside the instruction string', () => {
      const r = parseDebug('{"kind":"retry","instruction":"run {{cmd}} first"}')
      expect(r).toEqual({ kind: 'retry', instruction: 'run {{cmd}} first' })
    })

    it('still falls back to human when there is no balanced object', () => {
      const r = parseDebug('I think you should retry with npm install.')
      expect(r.kind).toBe('human')
    })
  })
})

// Reading content[0].text is wrong on every model that runs adaptive thinking
// (Sonnet 5, Opus 5, Opus 4.8, Fable 5): the first block is a thinking block with no
// .text, so index 0 yields '' and the caller reports an empty answer while the model
// in fact replied. Broadcast's "Refine with AI" hit exactly this.
describe('extractText', () => {
  it('skips a leading thinking block and returns the text', () => {
    expect(extractText([
      { type: 'thinking', thinking: 'weighing the options' },
      { type: 'text', text: 'the rewritten prompt' },
    ])).toBe('the rewritten prompt')
  })

  it('joins multiple text blocks in order', () => {
    expect(extractText([
      { type: 'text', text: 'first' },
      { type: 'thinking', thinking: 'aside' },
      { type: 'text', text: ' second' },
    ])).toBe('first second')
  })

  it('returns the text when it is the only block', () => {
    expect(extractText([{ type: 'text', text: 'plain' }])).toBe('plain')
  })

  it('returns empty string when no text block is present', () => {
    expect(extractText([{ type: 'thinking', thinking: 'only thought' }])).toBe('')
  })

  it('tolerates non-array and empty content', () => {
    expect(extractText(undefined)).toBe('')
    expect(extractText(null)).toBe('')
    expect(extractText([])).toBe('')
  })
})

// Thinking tokens count against max_tokens, so a budget spent entirely on thinking
// returns no text block at all. Left unguarded the parsers degrade quietly —
// parseDecision('') is a well-formed { kind: 'reply', text: '' } that writes an empty
// reply into the doer's PTY and looks like normal operation. Every caller escalates or
// reports on a throw, so failing loudly is the only way this stays visible.
describe('assertUsableText', () => {
  it('passes usable text through unchanged', () => {
    expect(assertUsableText('{"kind":"done"}', 'end_turn', 'decide')).toBe('{"kind":"done"}')
  })

  it('throws with a ceiling-specific message when Anthropic truncates', () => {
    expect(() => assertUsableText('', 'max_tokens', 'decide'))
      .toThrow(/decide: hit the token ceiling/)
    expect(() => assertUsableText('', 'max_tokens', 'decide'))
      .toThrow(/raise max_tokens or lower reasoning effort/i)
  })

  // OpenRouter signals the same condition as finish_reason 'length'.
  it('throws on an OpenRouter length stop', () => {
    expect(() => assertUsableText('', 'length', 'chat')).toThrow(/chat: hit the token ceiling/)
  })

  it('throws distinctly when the model simply returned nothing', () => {
    expect(() => assertUsableText('', 'end_turn', 'debug')).toThrow(/debug: model returned no text/)
    expect(() => assertUsableText('', undefined, 'debug')).toThrow(/stop_reason=unknown/)
  })

  it('treats whitespace-only output as empty', () => {
    expect(() => assertUsableText('   \n  ', 'end_turn', 'chat')).toThrow(/returned no text/)
  })
})

// Regression pin: these were 250-400 when every model was non-thinking. A ceiling that
// low can be consumed entirely by thinking before any text is emitted. Raising them is
// free — billing is on tokens produced, not on the ceiling.
describe('token ceilings', () => {
  it('leaves room for thinking as well as the answer', () => {
    expect(MAX_TOKENS_DECIDE).toBeGreaterThanOrEqual(2048)
    expect(MAX_TOKENS_DEBUG).toBeGreaterThanOrEqual(2048)
    expect(MAX_TOKENS_CHAT).toBeGreaterThanOrEqual(2048)
  })
})
