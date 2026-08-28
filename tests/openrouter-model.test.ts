import { describe, expect, it } from 'vitest'
import {
  getOpenRouterModel,
  setOpenRouterModel,
  supportsOpenRouterModelArg,
} from '../src/shared/openrouter-model'
import { normalizeApiModel } from '../src/main/openrouter-catalogue'

describe('openrouter model selection on the command line', () => {
  it('knows which CLIs can be pointed at OpenRouter', () => {
    expect(supportsOpenRouterModelArg('codex')).toBe(true)
    expect(supportsOpenRouterModelArg('opencode')).toBe(true)
    expect(supportsOpenRouterModelArg('claude')).toBe(false)
    expect(supportsOpenRouterModelArg('grok')).toBe(false)
  })

  // Codex needs model_provider alongside model: config.toml's top-level provider is
  // OpenAI, so overriding the model alone would post an OpenRouter id to OpenAI.
  it('sets a codex model via -c overrides, always with the provider', () => {
    const args = setOpenRouterModel('codex', '--sandbox workspace-write', 'z-ai/glm-5.3-flash')
    expect(args).toBe('--sandbox workspace-write -c model=z-ai/glm-5.3-flash -c model_provider=openrouter')
    expect(getOpenRouterModel('codex', args)).toBe('z-ai/glm-5.3-flash')
  })

  it('sets an opencode model via -m with the openrouter prefix', () => {
    const args = setOpenRouterModel('opencode', '--auto', 'z-ai/glm-5.3-flash')
    expect(args).toBe('--auto -m openrouter/z-ai/glm-5.3-flash')
    // Read back without the prefix, so callers compare against catalogue ids directly.
    expect(getOpenRouterModel('opencode', args)).toBe('z-ai/glm-5.3-flash')
  })

  it('replaces rather than stacks when the model changes', () => {
    let args = setOpenRouterModel('codex', '', 'z-ai/glm-5.3-flash')
    args = setOpenRouterModel('codex', args, 'deepseek/deepseek-v4-pro')
    expect(args).toBe('-c model=deepseek/deepseek-v4-pro -c model_provider=openrouter')
    expect(args).not.toContain('glm')

    let oc = setOpenRouterModel('opencode', '', 'z-ai/glm-5.3-flash')
    oc = setOpenRouterModel('opencode', oc, 'minimax/minimax-m3')
    expect(oc).toBe('-m openrouter/minimax/minimax-m3')
  })

  it('clears the selection without disturbing other flags', () => {
    const codex = setOpenRouterModel('codex', '--sandbox workspace-write -c model=z-ai/glm-5.3 -c model_provider=openrouter --search', null)
    expect(codex).toBe('--sandbox workspace-write --search')

    const oc = setOpenRouterModel('opencode', '--auto -m openrouter/z-ai/glm-5.3 --mini', null)
    expect(oc).toBe('--auto --mini')
  })

  // `model_provider=` starts with `model`, so a naive startsWith would read the provider
  // as the model id and report "openrouter" as the selection.
  it('does not confuse model_provider for model', () => {
    expect(getOpenRouterModel('codex', '-c model_provider=openrouter')).toBeNull()
    expect(getOpenRouterModel('codex', '-c model_provider=openrouter -c model=qwen/qwen3.8-max')).toBe('qwen/qwen3.8-max')
  })

  it('leaves unrelated -c overrides alone', () => {
    const args = setOpenRouterModel('codex', '-c model_reasoning_effort=high', 'z-ai/glm-5.3')
    expect(args).toContain('-c model_reasoning_effort=high')
    const cleared = setOpenRouterModel('codex', args, null)
    expect(cleared).toBe('-c model_reasoning_effort=high')
  })

  it('reports no model when none is set, and ignores CLIs that cannot take one', () => {
    expect(getOpenRouterModel('codex', '--sandbox workspace-write')).toBeNull()
    expect(getOpenRouterModel('opencode', '--auto')).toBeNull()
    expect(getOpenRouterModel('claude', '--model sonnet')).toBeNull()
    expect(setOpenRouterModel('claude', '--model sonnet', 'z-ai/glm-5.3')).toBe('--model sonnet')
  })
})

describe('openrouter catalogue normalization', () => {
  const raw = {
    id: 'z-ai/glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    context_length: 1310720,
    supported_parameters: ['tools', 'reasoning'],
    pricing: { prompt: '0.000000075', completion: '0.00000025', input_cache_read: '0.000000015' },
  }

  it('converts per-token strings to per-million numbers', () => {
    const m = normalizeApiModel(raw)!
    expect(m.rate.input).toBeCloseTo(0.075, 6)
    expect(m.rate.output).toBeCloseTo(0.25, 6)
    expect(m.rate.cachedInput).toBeCloseTo(0.015, 6)
    expect(m.supportsTools).toBe(true)
    expect(m.contextLength).toBe(1310720)
  })

  // Only ~60% of models quote cache pricing; the rest bill cached reads at full input
  // rate, so input is the correct fallback rather than zero.
  it('falls back to the input rate when cache pricing is absent', () => {
    const m = normalizeApiModel({ ...raw, pricing: { prompt: '0.000001', completion: '0.000002' } })!
    expect(m.rate.cachedInput).toBeCloseTo(1, 6)
    expect(m.rate.cacheCreation).toBeCloseTo(1, 6)
  })

  // A zero rate would silently disable the Autopilot cost cap for that model, which is
  // worse than the model being missing from the picker.
  it('drops entries with unusable pricing rather than defaulting them to zero', () => {
    expect(normalizeApiModel({ ...raw, pricing: {} })).toBeNull()
    expect(normalizeApiModel({ ...raw, pricing: { prompt: '0.000001' } })).toBeNull()
    expect(normalizeApiModel({ id: '', pricing: raw.pricing })).toBeNull()
    expect(normalizeApiModel(null)).toBeNull()
  })

  it('marks models without tool support', () => {
    const m = normalizeApiModel({ ...raw, supported_parameters: ['reasoning'] })!
    expect(m.supportsTools).toBe(false)
  })
})
