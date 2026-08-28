export type AgentCli = 'claude' | 'codex' | 'grok' | 'opencode'

export interface AgentCliLaunchOption {
  id: string
  label: string
  args: string
  dangerous?: boolean
  conflictsWith?: string[]
}

export interface AgentCliLaunchOptionGroup {
  id: string
  label: string
  mode: 'single' | 'multi'
  options: AgentCliLaunchOption[]
}

export interface AgentArgsSettings {
  claudeArgs?: string
  codexArgs?: string
  grokArgs?: string
  opencodeArgs?: string
}

export interface AutopilotRuntimeGuardrail {
  agentCli: AgentCli
  canStart: boolean
  reason: string | null
  warnings: string[]
}

export const DEFAULT_AGENT_CLI: AgentCli = 'claude'

export const AGENT_CLI_LABELS: Record<AgentCli, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  opencode: 'OpenCode',
}

export const AGENT_CLIS = Object.keys(AGENT_CLI_LABELS) as AgentCli[]

export const AGENT_CLI_COMMANDS: Record<AgentCli, string> = {
  claude: 'claude',
  codex: 'codex',
  grok: 'grok',
  opencode: 'opencode',
}

export const AGENT_CLI_ARGS_PLACEHOLDERS: Record<AgentCli, string> = {
  claude: 'e.g. --dangerously-skip-permissions --continue',
  codex: 'e.g. --sandbox workspace-write',
  grok: 'e.g. --permission-mode acceptEdits --continue',
  opencode: 'e.g. --auto -m openrouter/z-ai/glm-5.3-flash',
}

// One OpenRouter roster, two ways of reaching it — kept in a single list so the two
// pickers cannot drift apart:
//
//   Codex    `-p <profile>`  reads ~/.codex/<profile>.config.toml. Codex cannot express a
//                            base URL as a flag, so a profile file is the only route to a
//                            non-OpenAI model.
//   OpenCode `-m openrouter/<model>`  needs no config file at all: OpenCode discovers the
//                            provider from OPENROUTER_API_KEY in the environment.
//
// Selecting nothing leaves each CLI's own configured default alone.
export interface OpenRouterModelChoice {
  /** Codex profile name; the basename of ~/.codex/<profile>.config.toml. */
  profile: string
  /** OpenRouter model id, as it appears after the `openrouter/` prefix in OpenCode. */
  model: string
  label: string
}

export const OPENROUTER_MODEL_ROSTER: OpenRouterModelChoice[] = [
  { profile: 'glm', model: 'z-ai/glm-5.3-flash', label: 'GLM Flash' },
  { profile: 'glm-max', model: 'z-ai/glm-5.3', label: 'GLM 5.3' },
  { profile: 'ds-flash', model: 'deepseek/deepseek-v4-flash', label: 'DeepSeek Flash' },
  { profile: 'ds-pro', model: 'deepseek/deepseek-v4-pro', label: 'DeepSeek Pro' },
  { profile: 'qwen-lite', model: 'qwen/qwen3.7-flash', label: 'Qwen Lite' },
  { profile: 'qwen-flash', model: 'qwen/qwen3.8-flash', label: 'Qwen Flash' },
  { profile: 'qwen-max', model: 'qwen/qwen3.8-max', label: 'Qwen Max' },
  { profile: 'kimi-code', model: 'moonshotai/kimi-k2.7-code', label: 'Kimi Code' },
  { profile: 'kimi-k3', model: 'moonshotai/kimi-k3', label: 'Kimi K3' },
  { profile: 'minimax', model: 'minimax/minimax-m3', label: 'MiniMax M3' },
]

export const CODEX_MODEL_OPTION_IDS = OPENROUTER_MODEL_ROSTER.map((entry) => `codex-model-${entry.profile}`)

export const AGENT_CLI_OPTION_GROUPS: Record<AgentCli, AgentCliLaunchOptionGroup[]> = {
  claude: [
    {
      id: 'session',
      label: 'Session',
      mode: 'single',
      options: [
        { id: 'claude-continue', label: 'Continue', args: '--continue' },
      ],
    },
    {
      id: 'permission',
      label: 'Permission Mode',
      mode: 'single',
      options: [
        { id: 'claude-permission-default', label: 'Default', args: '--permission-mode default' },
        { id: 'claude-permission-auto', label: 'Auto', args: '--permission-mode auto' },
        { id: 'claude-permission-accept-edits', label: 'Accept Edits', args: '--permission-mode acceptEdits' },
        { id: 'claude-permission-dont-ask', label: "Don't Ask", args: '--permission-mode dontAsk' },
        { id: 'claude-permission-plan', label: 'Plan', args: '--permission-mode plan' },
        { id: 'claude-skip-permissions', label: 'Skip Permissions', args: '--dangerously-skip-permissions', dangerous: true },
        { id: 'claude-allow-skip-permissions', label: 'Allow Skip Toggle', args: '--allow-dangerously-skip-permissions', dangerous: true },
      ],
    },
    {
      id: 'model',
      label: 'Model',
      mode: 'single',
      options: [
        { id: 'claude-model-sonnet', label: 'Sonnet', args: '--model sonnet' },
        { id: 'claude-model-opus', label: 'Opus', args: '--model opus[1m]' },
        { id: 'claude-model-haiku', label: 'Haiku', args: '--model haiku' },
        { id: 'claude-model-fable', label: 'Fable', args: '--model claude-fable-5' },
      ],
    },
    {
      id: 'effort',
      label: 'Effort',
      mode: 'single',
      options: [
        { id: 'claude-effort-low', label: 'Low', args: '--effort low' },
        { id: 'claude-effort-medium', label: 'Medium', args: '--effort medium' },
        { id: 'claude-effort-high', label: 'High', args: '--effort high' },
        { id: 'claude-effort-xhigh', label: 'XHigh', args: '--effort xhigh' },
        { id: 'claude-effort-max', label: 'Max', args: '--effort max' },
        { id: 'claude-effort-ultracode', label: 'Ultracode', args: '--effort ultracode' },
      ],
    },
    {
      id: 'integration',
      label: 'Integration',
      mode: 'multi',
      options: [
        { id: 'claude-ide', label: 'IDE', args: '--ide' },
        { id: 'claude-verbose', label: 'Verbose', args: '--verbose' },
        { id: 'claude-bare', label: 'Bare', args: '--bare' },
      ],
    },
    {
      id: 'browser',
      label: 'Browser',
      mode: 'single',
      options: [
        { id: 'claude-chrome', label: 'Chrome', args: '--chrome' },
        { id: 'claude-no-chrome', label: 'No Chrome', args: '--no-chrome' },
      ],
    },
  ],
  codex: [
    {
      id: 'automation',
      label: 'Automation',
      mode: 'multi',
      options: [
        {
          id: 'codex-autopilot-full-auto',
          label: 'Autopilot Full Auto',
          args: '--sandbox workspace-write --ask-for-approval never --search',
          conflictsWith: [
            'codex-sandbox-read-only',
            'codex-sandbox-workspace-write',
            'codex-sandbox-danger-full-access',
            'codex-approval-untrusted',
            'codex-approval-on-request',
            'codex-approval-never',
            'codex-search',
            'codex-dangerous-bypass',
          ],
        },
      ],
    },
    {
      id: 'session',
      label: 'Session',
      mode: 'single',
      options: [
        { id: 'codex-resume-last', label: 'Resume Last', args: 'resume --last' },
      ],
    },
    {
      id: 'model',
      label: 'Model',
      mode: 'single',
      options: OPENROUTER_MODEL_ROSTER.map((entry) => ({
        id: `codex-model-${entry.profile}`,
        label: entry.label,
        args: `-p ${entry.profile}`,
        // --oss forces the local provider, which overrides the profile's model_provider.
        conflictsWith: ['codex-oss'],
      })),
    },
    {
      id: 'sandbox',
      label: 'Sandbox',
      mode: 'single',
      options: [
        { id: 'codex-sandbox-read-only', label: 'Read Only', args: '--sandbox read-only', conflictsWith: ['codex-dangerous-bypass'] },
        { id: 'codex-sandbox-workspace-write', label: 'Workspace Write', args: '--sandbox workspace-write', conflictsWith: ['codex-dangerous-bypass'] },
        { id: 'codex-sandbox-danger-full-access', label: 'Full Access', args: '--sandbox danger-full-access', dangerous: true, conflictsWith: ['codex-dangerous-bypass'] },
      ],
    },
    {
      id: 'approval',
      label: 'Approvals',
      mode: 'single',
      options: [
        { id: 'codex-approval-untrusted', label: 'Untrusted', args: '--ask-for-approval untrusted', conflictsWith: ['codex-dangerous-bypass'] },
        { id: 'codex-approval-on-request', label: 'On Request', args: '--ask-for-approval on-request', conflictsWith: ['codex-dangerous-bypass'] },
        { id: 'codex-approval-never', label: 'Never Ask', args: '--ask-for-approval never', dangerous: true, conflictsWith: ['codex-dangerous-bypass'] },
        { id: 'codex-approve-for-me', label: 'Approve For Me', args: '--approve-for-me', conflictsWith: ['codex-dangerous-bypass'] },
      ],
    },
    {
      id: 'features',
      label: 'Features',
      mode: 'multi',
      options: [
        { id: 'codex-search', label: 'Search', args: '--search' },
        { id: 'codex-no-alt-screen', label: 'Inline Scrollback', args: '--no-alt-screen' },
        { id: 'codex-oss', label: 'OSS Provider', args: '--oss', conflictsWith: CODEX_MODEL_OPTION_IDS },
      ],
    },
    {
      id: 'danger',
      label: 'Danger Zone',
      mode: 'multi',
      options: [
        {
          id: 'codex-dangerous-bypass',
          label: 'Bypass All',
          args: '--dangerously-bypass-approvals-and-sandbox',
          dangerous: true,
          conflictsWith: [
            'codex-sandbox-read-only',
            'codex-sandbox-workspace-write',
            'codex-sandbox-danger-full-access',
            'codex-approval-untrusted',
            'codex-approval-on-request',
            'codex-approval-never',
          ],
        },
      ],
    },
  ],
  grok: [
    {
      id: 'session',
      label: 'Session',
      mode: 'single',
      options: [
        { id: 'grok-continue', label: 'Continue', args: '--continue' },
      ],
    },
    {
      id: 'permission',
      label: 'Permission Mode',
      mode: 'single',
      options: [
        { id: 'grok-permission-default', label: 'Default', args: '--permission-mode default' },
        { id: 'grok-permission-auto', label: 'Auto', args: '--permission-mode auto' },
        { id: 'grok-permission-accept-edits', label: 'Accept Edits', args: '--permission-mode acceptEdits' },
        { id: 'grok-permission-dont-ask', label: "Don't Ask", args: '--permission-mode dontAsk' },
        { id: 'grok-permission-plan', label: 'Plan', args: '--permission-mode plan' },
        { id: 'grok-permission-bypass', label: 'Bypass Permissions', args: '--permission-mode bypassPermissions', dangerous: true },
        { id: 'grok-permission-dontask', label: 'Do Not Ask', args: '--permission-mode dontAsk' },
      ],
    },
    {
      id: 'effort',
      label: 'Effort',
      mode: 'single',
      options: [
        { id: 'grok-effort-low', label: 'Low', args: '--effort low' },
        { id: 'grok-effort-medium', label: 'Medium', args: '--effort medium' },
        { id: 'grok-effort-high', label: 'High', args: '--effort high' },
      ],
    },
    {
      id: 'features',
      label: 'Features',
      mode: 'multi',
      options: [
        { id: 'grok-no-alt-screen', label: 'Inline Scrollback', args: '--no-alt-screen' },
        { id: 'grok-disable-web-search', label: 'No Web Search', args: '--disable-web-search' },
        { id: 'grok-no-plan', label: 'No Plan Mode', args: '--no-plan' },
        { id: 'grok-always-approve', label: 'Always Approve', args: '--always-approve', dangerous: true },
        { id: 'grok-fullscreen', label: 'Fullscreen', args: '--fullscreen' },
      ],
    },
  ],
  opencode: [
    {
      id: 'session',
      // Independent toggles, not a single-select: `--continue --fork` is a legitimate
      // pairing, and a compound option would also report `--continue` as active because
      // getActiveAgentCliLaunchOptionIds matches token subsequences without group context.
      label: 'Session',
      mode: 'multi',
      options: [
        { id: 'opencode-continue', label: 'Continue', args: '--continue' },
        // Branches off the resumed session rather than appending; OpenCode ignores it
        // unless --continue or --session is also present.
        { id: 'opencode-fork', label: 'Fork', args: '--fork' },
      ],
    },
    {
      id: 'model',
      label: 'Model',
      mode: 'single',
      options: OPENROUTER_MODEL_ROSTER.map((entry) => ({
        id: `opencode-model-${entry.profile}`,
        label: entry.label,
        args: `-m openrouter/${entry.model}`,
      })),
    },
    {
      id: 'permission',
      label: 'Permission',
      mode: 'single',
      options: [
        // OpenCode's own wording is "auto-approve permissions that are not explicitly
        // denied (dangerous!)" — deny rules in opencode.json still apply.
        { id: 'opencode-auto', label: 'Auto Approve', args: '--auto', dangerous: true },
      ],
    },
    {
      id: 'interface',
      label: 'Interface',
      mode: 'single',
      options: [
        { id: 'opencode-mini', label: 'Mini', args: '--mini' },
      ],
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      mode: 'multi',
      options: [
        { id: 'opencode-pure', label: 'No Plugins', args: '--pure' },
        { id: 'opencode-print-logs', label: 'Print Logs', args: '--print-logs' },
      ],
    },
  ],
}

export function normalizeAgentCli(value: unknown): AgentCli {
  return typeof value === 'string' && (AGENT_CLIS as string[]).includes(value) ? (value as AgentCli) : DEFAULT_AGENT_CLI
}

const AGENT_ARGS_KEYS: Record<AgentCli, keyof AgentArgsSettings> = {
  claude: 'claudeArgs',
  codex: 'codexArgs',
  grok: 'grokArgs',
  opencode: 'opencodeArgs',
}

export function getArgsForAgent(agentCli: AgentCli, settings: AgentArgsSettings): string {
  return settings[AGENT_ARGS_KEYS[agentCli]] || ''
}

export function buildAgentLaunchCommand(agentCli: AgentCli, args: string | undefined): string {
  const command = AGENT_CLI_COMMANDS[agentCli]
  const trimmed = (args || '').trim()
  return trimmed ? `${command} ${trimmed}\r` : `${command}\r`
}

/** How each CLI resumes a previous conversation. 'flag' = claude-style
 *  --continue/--resume flags; 'subcommand' = codex-style `resume --last`,
 *  which must precede any options. */
const RESUME_STYLE: Record<AgentCli, 'flag' | 'subcommand'> = {
  claude: 'flag',
  grok: 'flag',
  // OpenCode takes -c/--continue like Claude, not a `resume` subcommand like Codex.
  opencode: 'flag',
  codex: 'subcommand',
}

export function stripResumeArgsForQuickLaunch(agentCli: AgentCli, args: string): string {
  let next = args
  if (RESUME_STYLE[agentCli] === 'flag') {
    next = next.replace(/(^|\s)(--continue|-c)(?=\s|$)/g, ' ')
  } else {
    next = next.replace(/(^|\s)resume(\s+--last)?(?=\s|$)/g, ' ')
  }
  return next.replace(/\s+/g, ' ').trim()
}

export function ensureResumeArgs(agentCli: AgentCli, args: string): string {
  const trimmed = args.trim()
  if (RESUME_STYLE[agentCli] === 'flag') {
    if (/(^|\s)(--continue|-c|--resume|-r)(?=\s|$)/.test(trimmed)) return trimmed
    return trimmed ? `${trimmed} --continue` : '--continue'
  }
  if (/(^|\s)resume(?=\s|$)/.test(trimmed)) return trimmed
  return trimmed ? `resume --last ${trimmed}` : 'resume --last'
}

export function getAutopilotRuntimeGuardrail(agentCli: AgentCli, args: string): AutopilotRuntimeGuardrail {
  const normalized = normalizeAgentCli(agentCli)
  const tokens = tokenizeArgs(args)
  const has = (sequence: string): boolean => hasTokenSequence(tokens, tokenizeArgs(sequence))
  const hasAny = (...sequences: string[]): boolean => sequences.some((sequence) => has(sequence))
  const hasOptionValue = (names: string[], value: string): boolean => getOptionValues(tokens, names).includes(value)

  if (normalized === 'claude') {
    const warnings: string[] = []
    if (hasAny('--dangerously-skip-permissions') || hasOptionValue(['--permission-mode'], 'bypassPermissions')) {
      warnings.push('Claude permission bypass is enabled; Autopilot will still enforce app-level pause, cost, and marker guardrails.')
    }
    return { agentCli: normalized, canStart: true, reason: null, warnings }
  }

  if (normalized === 'grok') {
    const warnings: string[] = []
    if (hasOptionValue(['--permission-mode'], 'bypassPermissions')) {
      warnings.push('Grok permission bypass is enabled; Autopilot will still enforce app-level pause, cost, and marker guardrails.')
    }
    return { agentCli: normalized, canStart: true, reason: null, warnings }
  }

  // OpenCode runs as a normal grid session but is not wired for Autopilot. Its approval
  // prompt offers once/always/reject rather than Grok's numbered choices, so the runtime
  // has no permissionReplies to send, and the doer marker contract has not been verified
  // against its TUI. Blocking here is deliberate: a half-supported orchestrator fails as a
  // run that stalls at a checkpoint, which is far harder to diagnose than a refusal.
  if (normalized === 'opencode') {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Autopilot does not support OpenCode yet. Use Claude, Codex, or Grok for Autopilot runs; OpenCode is available for normal sessions.',
      warnings: [],
    }
  }

  if (has('resume --last')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex Autopilot requires a fresh Codex session; remove resume --last before starting Autopilot.',
      warnings: [],
    }
  }

  if (has('--dangerously-bypass-approvals-and-sandbox')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex Autopilot blocks --dangerously-bypass-approvals-and-sandbox. Use sandboxed full auto instead.',
      warnings: [],
    }
  }

  if (hasOptionValue(['--sandbox', '-s'], 'danger-full-access')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex Autopilot blocks danger-full-access. Use --sandbox workspace-write.',
      warnings: [],
    }
  }

  if (hasOptionValue(['--sandbox', '-s'], 'read-only')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex Autopilot needs workspace-write sandbox access so the Doer can edit project files.',
      warnings: [],
    }
  }

  const fullAutoCompat = has('--full-auto')
  if (!fullAutoCompat && !hasOptionValue(['--sandbox', '-s'], 'workspace-write')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex Autopilot requires --sandbox workspace-write.',
      warnings: [],
    }
  }

  if (!fullAutoCompat && !hasOptionValue(['--ask-for-approval', '-a'], 'never')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex Autopilot requires --ask-for-approval never so the app is not blocked by unsupported Codex approval prompts.',
      warnings: [],
    }
  }

  const warnings: string[] = []
  if (fullAutoCompat) {
    warnings.push('--full-auto is accepted for compatibility; prefer --sandbox workspace-write --ask-for-approval never.')
  }
  if (has('--oss')) {
    warnings.push('Codex OSS provider is enabled; verify it supports the expected tool and marker behavior before long runs.')
  }
  return { agentCli: normalized, canStart: true, reason: null, warnings }
}

export function getCouncilReviewerRuntimeGuardrail(agentCli: AgentCli, args: string): AutopilotRuntimeGuardrail {
  const normalized = normalizeAgentCli(agentCli)
  const tokens = tokenizeArgs(args)
  const has = (sequence: string): boolean => hasTokenSequence(tokens, tokenizeArgs(sequence))
  const hasAny = (...sequences: string[]): boolean => sequences.some((sequence) => has(sequence))
  const hasOptionValue = (names: string[], value: string): boolean => getOptionValues(tokens, names).includes(value)
  const hasOption = (names: string[]): boolean =>
    tokens.some((token) => names.some((name) => token === name || token.startsWith(`${name}=`)))

  if (normalized === 'claude') {
    const warnings: string[] = []
    if (hasAny('--dangerously-skip-permissions') || hasOptionValue(['--permission-mode'], 'bypassPermissions')) {
      warnings.push('Claude permission bypass is enabled for a reviewer session; prefer a review-only permission mode.')
    }
    return { agentCli: normalized, canStart: true, reason: null, warnings }
  }

  if (normalized === 'grok') {
    const warnings: string[] = []
    if (hasOptionValue(['--permission-mode'], 'bypassPermissions')) {
      warnings.push('Grok permission bypass is enabled for a reviewer session; prefer a review-only permission mode.')
    }
    return { agentCli: normalized, canStart: true, reason: null, warnings }
  }

  if (normalized === 'opencode') {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Council reviewers do not support OpenCode yet. Use Claude, Codex, or Grok as the reviewer CLI.',
      warnings: [],
    }
  }

  if (has('resume --last')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex council reviewer blocks resume --last because reviewer sessions must start from a clean prompt.',
      warnings: [],
    }
  }

  if (has('--dangerously-bypass-approvals-and-sandbox')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex council reviewer blocks --dangerously-bypass-approvals-and-sandbox. Use --sandbox read-only.',
      warnings: [],
    }
  }

  if (hasOptionValue(['--sandbox', '-s'], 'danger-full-access')) {
    return {
      agentCli: normalized,
      canStart: false,
      reason: 'Codex council reviewer blocks danger-full-access. Use --sandbox read-only.',
      warnings: [],
    }
  }

  const warnings: string[] = []
  if (hasOptionValue(['--sandbox', '-s'], 'workspace-write')) {
    warnings.push('Codex council reviewers should run read-only; prefer --sandbox read-only unless write access is explicitly required.')
  } else if (!hasOption(['--sandbox', '-s'])) {
    warnings.push('Codex council reviewers should specify --sandbox read-only.')
  }

  if (!hasOptionValue(['--ask-for-approval', '-a'], 'never')) {
    warnings.push('Codex council reviewers should specify --ask-for-approval never to avoid unsupported approval prompts.')
  }

  return { agentCli: normalized, canStart: true, reason: null, warnings }
}

export function getActiveAgentCliLaunchOptionIds(agentCli: AgentCli, args: string): string[] {
  const tokens = tokenizeArgs(args)
  return getAllLaunchOptions(agentCli)
    .filter((option) => hasTokenSequence(tokens, tokenizeArgs(option.args)))
    .map((option) => option.id)
}

export function applyAgentCliLaunchOption(agentCli: AgentCli, args: string, optionId: string): string {
  const target = getAllLaunchOptions(agentCli).find((option) => option.id === optionId)
  if (!target) return normalizeArgs(args)

  const targetTokens = tokenizeArgs(target.args)
  let tokens = tokenizeArgs(args)
  const isActive = hasTokenSequence(tokens, targetTokens)

  const conflicts = getConflictingOptions(agentCli, target)
  for (const option of [target, ...conflicts]) {
    tokens = removeTokenSequence(tokens, tokenizeArgs(option.args))
  }

  if (!isActive) {
    tokens.push(...targetTokens)
  }

  return tokens.join(' ').trim()
}

function getAllLaunchOptions(agentCli: AgentCli): AgentCliLaunchOption[] {
  return AGENT_CLI_OPTION_GROUPS[agentCli].flatMap((group) => group.options)
}

function getConflictingOptions(agentCli: AgentCli, target: AgentCliLaunchOption): AgentCliLaunchOption[] {
  const groups = AGENT_CLI_OPTION_GROUPS[agentCli]
  const group = groups.find((candidate) => candidate.options.some((option) => option.id === target.id))
  const allOptions = groups.flatMap((candidate) => candidate.options)
  return allOptions.filter((option) => {
    if (option.id === target.id) return false
    const sameSingleGroup = group?.mode === 'single' && group.options.some((candidate) => candidate.id === option.id)
    const explicitConflict = target.conflictsWith?.includes(option.id)
    return sameSingleGroup || !!explicitConflict
  })
}

function normalizeArgs(args: string): string {
  return tokenizeArgs(args).join(' ').trim()
}

function tokenizeArgs(args: string): string[] {
  return args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
}

function getOptionValues(tokens: string[], names: string[]): string[] {
  const values: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    for (const name of names) {
      if (tokens[i] === name && tokens[i + 1]) {
        values.push(unquoteToken(tokens[i + 1]))
      } else if (tokens[i].startsWith(`${name}=`)) {
        values.push(unquoteToken(tokens[i].slice(name.length + 1)))
      }
    }
  }
  return values
}

function unquoteToken(token: string): string {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1)
  }
  return token
}

function hasTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0) return false
  return findTokenSequenceIndex(tokens, sequence) >= 0
}

function removeTokenSequence(tokens: string[], sequence: string[]): string[] {
  if (sequence.length === 0) return tokens
  let next = [...tokens]
  let index = findTokenSequenceIndex(next, sequence)
  while (index >= 0) {
    next = [...next.slice(0, index), ...next.slice(index + sequence.length)]
    index = findTokenSequenceIndex(next, sequence)
  }
  return next
}

function findTokenSequenceIndex(tokens: string[], sequence: string[]): number {
  if (sequence.length === 0 || sequence.length > tokens.length) return -1
  for (let i = 0; i <= tokens.length - sequence.length; i += 1) {
    let matched = true
    for (let j = 0; j < sequence.length; j += 1) {
      if (tokens[i + j] !== sequence[j]) {
        matched = false
        break
      }
    }
    if (matched) return i
  }
  return -1
}
