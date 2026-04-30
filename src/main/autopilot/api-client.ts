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
  'claude-sonnet-4-6':             { input: 3.0,  cachedInput: 0.30,  cacheCreation: 3.75,  output: 15.0 },
  'claude-opus-4-7':               { input: 15.0, cachedInput: 1.50,  cacheCreation: 18.75, output: 75.0 },

  // ---- OpenRouter — Google ----
  'google/gemini-2.5-flash':       { input: 0.30, cachedInput: 0.075, cacheCreation: 0.30,  output: 2.50 },
  'google/gemini-2.5-pro':         { input: 1.25, cachedInput: 0.31,  cacheCreation: 1.25,  output: 10.0 },

  // ---- OpenRouter — OpenAI ----
  'openai/gpt-5-mini':             { input: 0.25, cachedInput: 0.025, cacheCreation: 0.25,  output: 2.0  },
  'openai/gpt-5':                  { input: 1.25, cachedInput: 0.125, cacheCreation: 1.25,  output: 10.0 },

  // ---- OpenRouter — Moonshot (Kimi K2 family) ----
  'moonshotai/kimi-k2-0905':       { input: 0.40, cachedInput: 0.10,  cacheCreation: 0.40,  output: 2.0  },
  'moonshotai/kimi-k2.6':          { input: 0.75, cachedInput: 0.19,  cacheCreation: 0.75,  output: 3.50 },
  'moonshotai/kimi-k2-thinking':   { input: 0.60, cachedInput: 0.15,  cacheCreation: 0.60,  output: 2.50 },

  // ---- OpenRouter — DeepSeek / Qwen / xAI ----
  'deepseek/deepseek-v3.2-exp':    { input: 0.27, cachedInput: 0.07,  cacheCreation: 0.27,  output: 1.10 },
  'qwen/qwen3-coder':              { input: 0.20, cachedInput: 0.05,  cacheCreation: 0.20,  output: 0.80 },
  'x-ai/grok-4':                   { input: 3.0,  cachedInput: 0.75,  cacheCreation: 3.0,   output: 15.0 },

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
      max_tokens: 400,
      system: [
        { type: 'text', text: parts.cachedSystem, cache_control: { type: 'ephemeral' } as any },
        { type: 'text', text: parts.cachedGoalAndMilestones, cache_control: { type: 'ephemeral' } as any },
      ] as any,
      messages: [
        { role: 'user', content: parts.uncachedRecent },
      ],
    })

    const text = (response.content[0] as any)?.text ?? ''
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
      max_tokens: 250,
      system: [
        { type: 'text', text: parts.system, cache_control: { type: 'ephemeral' } as any },
      ] as any,
      messages: [{ role: 'user', content: parts.user }],
    })
    const text = (response.content[0] as any)?.text ?? ''
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
      body: JSON.stringify({ model: this.model, messages, max_tokens: 400 }),
    })

    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`)
    const data = await res.json() as any
    const text = data.choices?.[0]?.message?.content ?? ''
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
      body: JSON.stringify({ model: this.model, messages, max_tokens: 250 }),
    })
    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`)
    const data = await res.json() as any
    const text = data.choices?.[0]?.message?.content ?? ''
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

  estimateCost(usage: ApiUsage): number {
    // Use the actual model's rate if known; rateFor falls back to openrouter-default
    // for unrecognised provider/model IDs.
    return estimateCostFor(this.model, usage)
  }
}

export function makeApiClient(provider: ApiProvider, apiKey: string, model: string): ApiClient {
  return provider === 'anthropic' ? new AnthropicClient(apiKey, model) : new OpenRouterClient(apiKey, model)
}
