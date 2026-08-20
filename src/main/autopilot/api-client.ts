import Anthropic from '@anthropic-ai/sdk'
import type { ApiClient, ApiUsage, DecideInput, DecideResult, DebugInput, DebugResult, ApiProvider } from './types'
import { buildDecisionPrompt } from './prompts'

// USD per 1M tokens. cacheCreation = price to write a new cached prefix.
// cachedInput = price to read a previously-cached prefix.
// For providers without explicit cache pricing on OpenRouter, cacheCreation == input
// and cachedInput is set to a conservative ~25% discount (or matches the provider's
// published number where one exists). Treat these as ±20% estimates — the
// authoritative bill is always the provider's invoice.
const RATES: Record<string, { input: number; cachedInput: number; cacheCreation: number; output: number }> = {
  // ---- Anthropic (direct) ----
  'claude-haiku-4-5':              { input: 1.0,  cachedInput: 0.10,  cacheCreation: 1.25,  output: 5.0  },
  'claude-sonnet-5':               { input: 3.0,  cachedInput: 0.30,  cacheCreation: 3.75,  output: 15.0 },
  'claude-opus-5':                 { input: 5.0,  cachedInput: 0.50,  cacheCreation: 6.25,  output: 25.0 },
  'claude-opus-4-8':               { input: 5.0,  cachedInput: 0.50,  cacheCreation: 6.25,  output: 25.0 },
  'claude-fable-5':                { input: 10.0, cachedInput: 1.0,   cacheCreation: 12.5,  output: 50.0 },
  // Prior-gen (kept so existing saved configs still track accurately)
  'claude-sonnet-4-6':             { input: 3.0,  cachedInput: 0.30,  cacheCreation: 3.75,  output: 15.0 },
  'claude-opus-4-7':               { input: 5.0,  cachedInput: 0.50,  cacheCreation: 6.25,  output: 25.0 },

  // ---- OpenRouter ----
  // Regenerated from the live catalogue on 2026-08-20. Prices move: within 24 hours
  // deepseek-v4-pro-0813 went $0.66 -> $1.19 input and kimi-k2.6 $0.54 -> $0.95, so
  // treat this table as a snapshot and re-verify when the cost cap starts looking off.
  // Anything not listed falls through to openrouter-default below.

  'openai/gpt-5.6-luna':               { input: 0.20, cachedInput: 0.020, cacheCreation: 0.20, output: 1.20 },
  'openai/gpt-5.6-luna-pro':           { input: 0.20, cachedInput: 0.020, cacheCreation: 0.20, output: 1.20 },
  'openai/gpt-5.6-terra':              { input: 2.00, cachedInput: 0.200, cacheCreation: 2.00, output: 12.00 },
  'openai/gpt-5.6-terra-pro':          { input: 2.00, cachedInput: 0.200, cacheCreation: 2.00, output: 12.00 },
  'openai/gpt-5.6-sol':                { input: 2.50, cachedInput: 0.250, cacheCreation: 2.50, output: 15.00 },
  'openai/gpt-5.6-sol-pro':            { input: 2.50, cachedInput: 0.250, cacheCreation: 2.50, output: 15.00 },
  'qwen/qwen3.8-max':                  { input: 2.00, cachedInput: 0.250, cacheCreation: 2.00, output: 6.00 },
  'qwen/qwen3.8-27b':                  { input: 0.45, cachedInput: 0.050, cacheCreation: 0.45, output: 3.20 },
  'qwen/qwen3.8-2.4t-a95b':            { input: 2.00, cachedInput: 0.250, cacheCreation: 2.00, output: 6.00 },
  'qwen/qwen3.7-plus':                 { input: 0.32, cachedInput: 0.064, cacheCreation: 0.32, output: 1.28 },
  'qwen/qwen3.7-flash':                { input: 0.03, cachedInput: 0.006, cacheCreation: 0.03, output: 0.13 },
  'deepseek/deepseek-v4-flash-0731':   { input: 0.14, cachedInput: 0.028, cacheCreation: 0.14, output: 0.28 },
  'deepseek/deepseek-v4-pro-0813':     { input: 1.19, cachedInput: 0.040, cacheCreation: 1.19, output: 3.56 },
  'deepseek/deepseek-v4-flash':        { input: 0.09, cachedInput: 0.018, cacheCreation: 0.09, output: 0.18 },
  'google/gemini-3.7-flash':           { input: 0.38, cachedInput: 0.037, cacheCreation: 0.38, output: 1.88 },
  'google/gemini-3.1-flash-lite':      { input: 0.25, cachedInput: 0.025, cacheCreation: 0.25, output: 1.50 },
  'z-ai/glm-5.2':                      { input: 0.97, cachedInput: 0.193, cacheCreation: 0.97, output: 3.04 },
  'z-ai/glm-5.3':                      { input: 1.40, cachedInput: 0.260, cacheCreation: 1.40, output: 4.40 },
  'z-ai/glm-4.7-flash':                { input: 0.06, cachedInput: 0.010, cacheCreation: 0.06, output: 0.40 },
  'moonshotai/kimi-k3':                { input: 3.00, cachedInput: 0.300, cacheCreation: 3.00, output: 15.00 },
  'x-ai/grok-4.6':                     { input: 2.00, cachedInput: 0.500, cacheCreation: 2.00, output: 6.00 },
  'nvidia/nemotron-3.5-lightning':     { input: 0.08, cachedInput: 0.040, cacheCreation: 0.08, output: 0.20 },
  'minimax/minimax-m3':                { input: 0.30, cachedInput: 0.060, cacheCreation: 0.30, output: 1.20 },
  // Superseded, kept so existing saved configs still price accurately.
  'moonshotai/kimi-k2-0905':           { input: 0.60, cachedInput: 0.150, cacheCreation: 0.60, output: 2.50 },
  'moonshotai/kimi-k2.6':              { input: 0.95, cachedInput: 0.160, cacheCreation: 0.95, output: 4.00 },
  'google/gemini-2.5-flash':           { input: 0.30, cachedInput: 0.030, cacheCreation: 0.30, output: 2.50 },
  'google/gemini-2.5-pro':             { input: 1.25, cachedInput: 0.125, cacheCreation: 1.25, output: 10.00 },
  'openai/gpt-5-mini':                 { input: 0.25, cachedInput: 0.025, cacheCreation: 0.25, output: 2.00 },
  'openai/gpt-5':                      { input: 1.25, cachedInput: 0.125, cacheCreation: 1.25, output: 10.00 },
  'deepseek/deepseek-v3.2-exp':        { input: 0.27, cachedInput: 0.068, cacheCreation: 0.27, output: 0.41 },
  'qwen/qwen3-coder':                  { input: 0.30, cachedInput: 0.100, cacheCreation: 0.30, output: 1.00 },
  'deepseek/deepseek-v4-pro':          { input: 1.44, cachedInput: 0.121, cacheCreation: 1.44, output: 2.88 },

  // ---- Conservative fallback for any unknown OpenRouter model ----
  // Kept high so the cost cap errs on pausing too early rather than too late.
  'openrouter-default':            { input: 5.0,  cachedInput: 5.0,   cacheCreation: 5.0,   output: 20.0 },
}

function rateFor(model: string): typeof RATES['claude-sonnet-4-6'] {
  if (RATES[model]) return RATES[model]
  // Provider-prefixed IDs (e.g. "moonshotai/kimi-k2-0905") that aren't in the table
  // route through OpenRouter — use the conservative default. Plain names fall back to
  // Sonnet 4.6's rates.
  if (model.includes('/')) return RATES['openrouter-default']
  return RATES['claude-sonnet-4-6']
}

export function estimateCostFor(model: string, usage: ApiUsage): number {
  const r = rateFor(model)
  return (
    (usage.inputTokens / 1_000_000) * r.input +
    (usage.cachedInputTokens / 1_000_000) * r.cachedInput +
    (usage.cacheCreationTokens / 1_000_000) * r.cacheCreation +
    (usage.outputTokens / 1_000_000) * r.output
  )
}

/**
 * Concatenate every `text` block in a Messages response.
 *
 * Do NOT read `content[0].text` — on models that run adaptive thinking (Sonnet 5,
 * Opus 5, Opus 4.8, Fable 5) the first block is a `thinking` block with no `.text`,
 * so index 0 silently yields '' and the caller sees an "empty" answer.
 */
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text as string)
    .join('')
}

// Token ceilings must cover thinking as well as the visible answer: current Anthropic
// models run adaptive thinking unless told otherwise, and thinking tokens count against
// max_tokens. The previous 120-400 ceilings predate that and could be spent entirely on
// thinking, leaving no text block at all. Raising them costs nothing — billing is on
// tokens actually produced, never on the ceiling.
export const MAX_TOKENS_DECIDE = 4096
export const MAX_TOKENS_DEBUG = 4096
export const MAX_TOKENS_CHAT = 4096

/**
 * Convert a silently-truncated or text-free response into a visible error.
 *
 * When thinking consumes the whole budget the response carries no text block, and the
 * parsers degrade quietly: parseDecision('') yields { kind: 'reply', text: '' }, which
 * writes an empty reply into the doer's PTY and looks like normal operation. Every
 * caller either escalates or reports on a thrown error, so throwing is the honest
 * outcome — a stalled run with a reason beats a silent no-op.
 */
export function assertUsableText(text: string, stopReason: string | null | undefined, label: string): string {
  if (text.trim()) return text
  if (stopReason === 'max_tokens' || stopReason === 'length') {
    throw new Error(
      `${label}: hit the token ceiling before producing an answer (stop_reason=${stopReason}). ` +
      'Thinking likely consumed the whole budget — raise max_tokens or lower reasoning effort.',
    )
  }
  throw new Error(`${label}: model returned no text (stop_reason=${stopReason ?? 'unknown'}).`)
}

// ----- AnthropicClient -----

export class AnthropicClient implements ApiClient {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async decide(input: DecideInput): Promise<{ result: DecideResult; usage: ApiUsage }> {
    const parts = buildDecisionPrompt({
      goal: input.goal,
      milestones: input.milestones,
      currentMilestoneId: input.currentMilestoneId,
      recentLog: input.recentLogTail,
      snapshot: input.lastSnapshot,
      validation: input.validation,
      learnings: input.learnings,
      steering: input.steering,
    })

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS_DECIDE,
      system: [
        { type: 'text', text: parts.cachedSystem, cache_control: { type: 'ephemeral' } as any },
        { type: 'text', text: parts.cachedGoalAndMilestones, cache_control: { type: 'ephemeral' } as any },
      ] as any,
      messages: [
        { role: 'user', content: parts.uncachedRecent },
      ],
    })

    const text = assertUsableText(extractText(response.content), response.stop_reason, 'decide')
    const result = parseDecision(text)

    const u: any = response.usage as any
    const usage: ApiUsage = {
      inputTokens: u?.input_tokens ?? 0,
      cachedInputTokens: u?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
    }

    return { result, usage }
  }

  async debug(input: DebugInput): Promise<{ result: DebugResult; usage: ApiUsage }> {
    const parts = (await import('./prompts')).buildDebugPrompt(input)
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS_DEBUG,
      system: [
        { type: 'text', text: parts.system, cache_control: { type: 'ephemeral' } as any },
      ] as any,
      messages: [{ role: 'user', content: parts.user }],
    })
    const text = assertUsableText(extractText(response.content), response.stop_reason, 'debug')
    const result = parseDebug(text)
    const u: any = response.usage as any
    const usage: ApiUsage = {
      inputTokens: u?.input_tokens ?? 0,
      cachedInputTokens: u?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
    }
    return { result, usage }
  }

  async chat(args: { system: string; user: string; maxTokens?: number; reasoningOptional?: boolean }): Promise<{ text: string; usage: ApiUsage }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: args.maxTokens ?? MAX_TOKENS_CHAT,
      system: [
        { type: 'text', text: args.system, cache_control: { type: 'ephemeral' } as any },
      ] as any,
      messages: [{ role: 'user', content: args.user }],
    })
    const text = assertUsableText(extractText(response.content), response.stop_reason, 'chat')
    const u: any = response.usage as any
    const usage: ApiUsage = {
      inputTokens: u?.input_tokens ?? 0,
      cachedInputTokens: u?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
    }
    return { text, usage }
  }

  estimateCost(usage: ApiUsage): number {
    return estimateCostFor(this.model, usage)
  }
}

/**
 * Find the first balanced {...} block in text. Honours JSON string semantics
 * (escaped quotes, embedded braces inside strings). Returns null if no balanced
 * block exists. Used to recover from prose-before-JSON or prose-after-JSON
 * model outputs (common with Kimi K2, DeepSeek when system prompt is mild).
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function parseDecision(text: string): DecideResult {
  const trimmed = text.trim()
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  // Try the stripped string directly first (cheapest path); on failure or
  // unrecognised shape, try extracting the first balanced {...} block. This
  // recovers from "Sure, here is my decision: {...}" or "{...} — done!" style
  // outputs.
  const candidates = [stripped]
  const extracted = extractFirstJsonObject(stripped)
  if (extracted && extracted !== stripped) candidates.push(extracted)

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
        switch (obj.kind) {
          case 'reply':    return { kind: 'reply', text: String(obj.text ?? '') }
          case 'reset':    return { kind: 'reset' }
          case 'done':     return { kind: 'done', evidence: String(obj.evidence ?? '') }
          case 'escalate': return { kind: 'escalate', reason: String(obj.reason ?? 'unknown') }
        }
      }
    } catch { /* try next candidate */ }
  }
  return { kind: 'reply', text: stripped.slice(0, 1000) }
}

export function parseDebug(text: string): DebugResult {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  const candidates = [stripped]
  const extracted = extractFirstJsonObject(stripped)
  if (extracted && extracted !== stripped) candidates.push(extracted)

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
        switch (obj.kind) {
          case 'retry': return { kind: 'retry', instruction: String(obj.instruction ?? '').slice(0, 500) }
          case 'block': return { kind: 'block', reason: String(obj.reason ?? 'unknown') }
          case 'human': return { kind: 'human', reason: String(obj.reason ?? 'unknown') }
        }
      }
    } catch { /* try next candidate */ }
  }
  return { kind: 'human', reason: 'debug parse failed' }
}

// ----- OpenRouterClient -----

export class OpenRouterClient implements ApiClient {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
  }

  async decide(input: DecideInput): Promise<{ result: DecideResult; usage: ApiUsage }> {
    const parts = buildDecisionPrompt({
      goal: input.goal,
      milestones: input.milestones,
      currentMilestoneId: input.currentMilestoneId,
      recentLog: input.recentLogTail,
      snapshot: input.lastSnapshot,
      validation: input.validation,
      learnings: input.learnings,
      steering: input.steering,
    })

    const messages = [
      { role: 'system', content: parts.cachedSystem + '\n\n' + parts.cachedGoalAndMilestones },
      { role: 'user', content: parts.uncachedRecent },
    ]

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, messages, max_tokens: MAX_TOKENS_DECIDE }),
    })

    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`)
    const data = await res.json() as any
    const text = assertUsableText(data.choices?.[0]?.message?.content ?? '', data.choices?.[0]?.finish_reason, 'decide')
    const result = parseDecision(text)
    const u = data.usage ?? {}
    const usage: ApiUsage = {
      inputTokens: u.prompt_tokens ?? 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: u.completion_tokens ?? 0,
    }
    return { result, usage }
  }

  async debug(input: DebugInput): Promise<{ result: DebugResult; usage: ApiUsage }> {
    const parts = (await import('./prompts')).buildDebugPrompt(input)
    const messages = [
      { role: 'system', content: parts.system },
      { role: 'user', content: parts.user },
    ]
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, max_tokens: MAX_TOKENS_DEBUG }),
    })
    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`)
    const data = await res.json() as any
    const text = assertUsableText(data.choices?.[0]?.message?.content ?? '', data.choices?.[0]?.finish_reason, 'debug')
    const result = parseDebug(text)
    const u = data.usage ?? {}
    const usage: ApiUsage = {
      inputTokens: u.prompt_tokens ?? 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: u.completion_tokens ?? 0,
    }
    return { result, usage }
  }

  async chat(args: { system: string; user: string; maxTokens?: number; reasoningOptional?: boolean }): Promise<{ text: string; usage: ApiUsage }> {
    const messages = [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ]
    const post = (disableReasoning: boolean) => fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: args.maxTokens ?? MAX_TOKENS_CHAT,
        ...(disableReasoning ? { reasoning: { enabled: false } } : {}),
      }),
    })

    // The reasoning flag is never sent up front. Models differ too much: several
    // (gemini-3.7-flash, glm-5.3) reject it outright with 400 "Reasoning is mandatory",
    // and on most it changes nothing worth the risk of an unsupported parameter.
    //
    // It is only worth sending after a model has demonstrably starved itself: reasoning
    // tokens count against max_tokens, and deepseek-v4-flash and qwen3.7-flash were each
    // measured spending an entire budget reasoning and returning no content at all.
    // That shows up as finish_reason 'length' with empty content, so retry once there —
    // and only there, for a caller that has said reasoning is not needed for its task.
    let res = await post(false)
    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`)
    let data = await res.json() as any
    let choice = data.choices?.[0]

    const starved = !((choice?.message?.content ?? '').trim()) && choice?.finish_reason === 'length'
    if (starved && args.reasoningOptional) {
      const retry = await post(true)
      // A model that refuses the flag keeps its original (empty) response, which then
      // surfaces through assertUsableText as a truncation error rather than a silent ''.
      if (retry.ok) { data = await retry.json(); choice = data.choices?.[0] }
    }

    const text = assertUsableText(choice?.message?.content ?? '', choice?.finish_reason, 'chat')
    const u = data.usage ?? {}
    const usage: ApiUsage = {
      inputTokens: u.prompt_tokens ?? 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: u.completion_tokens ?? 0,
    }
    return { text, usage }
  }

  estimateCost(usage: ApiUsage): number {
    // Use the actual model's rate if known; rateFor falls back to openrouter-default
    // for unrecognised provider/model IDs.
    return estimateCostFor(this.model, usage)
  }
}

export function makeApiClient(provider: ApiProvider, apiKey: string, model: string): ApiClient {
  return provider === 'anthropic' ? new AnthropicClient(apiKey, model) : new OpenRouterClient(apiKey, model)
}
