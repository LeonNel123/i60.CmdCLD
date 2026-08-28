/**
 * Selecting an OpenRouter model on an agent CLI's command line.
 *
 * This is deliberately separate from AGENT_CLI_OPTION_GROUPS. Those groups are a fixed
 * set of flags known at build time; the model list is ~400 entries that change without
 * us shipping a release, so a model cannot be an option id. Instead the launch args
 * carry the model directly and these helpers read and rewrite that one concern,
 * leaving every other flag untouched.
 *
 * Two CLIs can reach OpenRouter, by different routes:
 *
 *   OpenCode  -m openrouter/<model>
 *             The provider is discovered from OPENROUTER_API_KEY in the environment.
 *
 *   Codex     -c model=<model> -c model_provider=openrouter
 *             `-c key=value` overrides config.toml for one invocation. This replaced an
 *             earlier `-p <profile>` scheme that required ~/.codex/<profile>.config.toml
 *             to exist, which is what pinned us to a hardcoded roster: a profile flag is
 *             only valid if someone created the file first. Overrides need no setup, so
 *             any catalogue entry is reachable.
 *
 * Model ids contain '/', '.' and '-' but never whitespace, so no quoting is needed and
 * the tokens survive tokenizeArgs unchanged.
 */
import type { AgentCli } from './agent-cli'

/** CLIs that can be pointed at an arbitrary OpenRouter model from the command line. */
export const OPENROUTER_CAPABLE_CLIS: AgentCli[] = ['codex', 'opencode']

export function supportsOpenRouterModelArg(agentCli: AgentCli): boolean {
  return OPENROUTER_CAPABLE_CLIS.includes(agentCli)
}

/** OpenCode namespaces OpenRouter under a provider prefix; Codex names the model bare. */
const OPENCODE_PREFIX = 'openrouter/'

function tokenize(args: string): string[] {
  return args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
}

function isModelId(token: string): boolean {
  // A bare flag or an unrelated `key=value` override is not a model id.
  return !token.startsWith('-') && !token.includes('=')
}

/**
 * The OpenRouter model currently selected in `args`, or null.
 * Returned without OpenCode's `openrouter/` prefix, so callers compare against catalogue
 * ids directly regardless of which CLI produced the args.
 */
export function getOpenRouterModel(agentCli: AgentCli, args: string): string | null {
  const tokens = tokenize(args)

  if (agentCli === 'opencode') {
    for (let i = 0; i < tokens.length; i++) {
      if ((tokens[i] === '-m' || tokens[i] === '--model') && isModelId(tokens[i + 1] ?? '')) {
        const value = tokens[i + 1]
        return value.startsWith(OPENCODE_PREFIX) ? value.slice(OPENCODE_PREFIX.length) : value
      }
    }
    return null
  }

  if (agentCli === 'codex') {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== '-c' && tokens[i] !== '--config') continue
      const pair = tokens[i + 1] ?? ''
      // Only `model=`, never `model_provider=` — startsWith would match both.
      if (pair.startsWith('model=')) return pair.slice('model='.length) || null
    }
    return null
  }

  return null
}

/**
 * Rewrite `args` so the OpenRouter model is `modelId`, or remove the selection when
 * `modelId` is null. Every unrelated flag keeps its position; the model tokens are
 * appended when newly added.
 */
export function setOpenRouterModel(agentCli: AgentCli, args: string, modelId: string | null): string {
  if (!supportsOpenRouterModelArg(agentCli)) return args.trim()

  const tokens = tokenize(args)
  const kept: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (agentCli === 'opencode' && (token === '-m' || token === '--model') && isModelId(tokens[i + 1] ?? '')) {
      i++ // drop the flag and its value
      continue
    }

    if (agentCli === 'codex' && (token === '-c' || token === '--config')) {
      const pair = tokens[i + 1] ?? ''
      if (pair.startsWith('model=') || pair.startsWith('model_provider=')) {
        i++
        continue
      }
    }

    kept.push(token)
  }

  if (modelId) {
    if (agentCli === 'opencode') {
      kept.push('-m', `${OPENCODE_PREFIX}${modelId}`)
    } else {
      // model_provider must accompany the model: config.toml's top-level provider is
      // OpenAI, and overriding the model alone would send an OpenRouter id there.
      kept.push('-c', `model=${modelId}`, '-c', 'model_provider=openrouter')
    }
  }

  return kept.join(' ').trim()
}
