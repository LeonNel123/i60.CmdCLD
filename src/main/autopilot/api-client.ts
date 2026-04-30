import Anthropic from '@anthropic-ai/sdk'
import type { ApiClient, ApiUsage, DecideInput, DecideResult, ApiProvider } from './types'
import { buildDecisionPrompt } from './prompts'

const RATES: Record<string, { input: number; cachedInput: number; cacheCreation: number; output: number }> = {
  'claude-sonnet-4-6':   { input: 3.0,  cachedInput: 0.30, cacheCreation: 3.75, output: 15.0 },
  'claude-opus-4-7':     { input: 15.0, cachedInput: 1.50, cacheCreation: 18.75, output: 75.0 },
  'claude-haiku-4-5':    { input: 1.0,  cachedInput: 0.10, cacheCreation: 1.25, output: 5.0 },
  'openrouter-default':  { input: 5.0,  cachedInput: 5.0,  cacheCreation: 5.0,  output: 20.0 },
}

function rateFor(model: string): typeof RATES['claude-sonnet-4-6'] {
  return RATES[model] ?? RATES['claude-sonnet-4-6']
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

  estimateCost(usage: ApiUsage): number {
    return estimateCostFor(this.model, usage)
  }
}

function parseDecision(text: string): DecideResult {
  const trimmed = text.trim()
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const obj = JSON.parse(stripped)
    if (obj && typeof obj === 'object' && typeof obj.kind === 'string') {
      switch (obj.kind) {
        case 'reply':    return { kind: 'reply', text: String(obj.text ?? '') }
        case 'reset':    return { kind: 'reset' }
        case 'done':     return { kind: 'done', evidence: String(obj.evidence ?? '') }
        case 'escalate': return { kind: 'escalate', reason: String(obj.reason ?? 'unknown') }
      }
    }
  } catch {
    // fall through
  }
  return { kind: 'reply', text: stripped.slice(0, 1000) }
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

  estimateCost(usage: ApiUsage): number {
    return estimateCostFor('openrouter-default', usage)
  }
}

export function makeApiClient(provider: ApiProvider, apiKey: string, model: string): ApiClient {
  return provider === 'anthropic' ? new AnthropicClient(apiKey, model) : new OpenRouterClient(apiKey, model)
}
