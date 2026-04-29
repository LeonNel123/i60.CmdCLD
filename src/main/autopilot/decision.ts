import type { ApiClient, DecideInput, DecideResult, ApiUsage } from './types'

export interface DecideOutput {
  result: DecideResult
  usage: ApiUsage
  costUsd: number
}

export async function decide(client: ApiClient, input: DecideInput): Promise<DecideOutput> {
  const { result, usage } = await client.decide(input)
  const costUsd = client.estimateCost(usage)
  return { result, usage, costUsd }
}
