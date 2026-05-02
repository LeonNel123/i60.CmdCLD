import { execFileSync } from 'child_process'
import { platform } from 'os'
import type { AgentCli } from '../shared/agent-cli'

export interface AgentCliAvailability {
  available: boolean
  path: string | null
}

export type AgentCliAvailabilityMap = Record<AgentCli, AgentCliAvailability>

function detectCommand(command: string): AgentCliAvailability {
  try {
    const isWindows = platform() === 'win32'
    const lookup = isWindows ? 'where.exe' : 'which'
    const out = execFileSync(lookup, [command], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
    const first = String(out).split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return first ? { available: true, path: first } : { available: false, path: null }
  } catch {
    return { available: false, path: null }
  }
}

export function detectAgentCliAvailability(): AgentCliAvailabilityMap {
  return {
    claude: detectCommand('claude'),
    codex: detectCommand('codex'),
  }
}
