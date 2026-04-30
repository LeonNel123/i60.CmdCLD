import type { ApiClient, DebugInput, DebugResult, ApiUsage } from './types'

export interface DebugOutput {
  result: DebugResult
  usage: ApiUsage
  costUsd: number
}

export async function debugCall(client: ApiClient, input: DebugInput): Promise<DebugOutput> {
  try {
    const { result, usage } = await client.debug(input)
    const costUsd = client.estimateCost(usage)
    return { result, usage, costUsd }
  } catch (e: any) {
    const msg = e?.message ?? 'debug call failed'
    return {
      result: { kind: 'human', reason: msg.slice(0, 200) },
      usage: { inputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 0 },
      costUsd: 0,
    }
  }
}
