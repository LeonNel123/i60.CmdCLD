export type AgentCli = 'claude' | 'codex'

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
}

export const AGENT_CLI_COMMANDS: Record<AgentCli, string> = {
  claude: 'claude',
  codex: 'codex',
}

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
        { id: 'claude-model-opus', label: 'Opus', args: '--model opus' },
        { id: 'claude-model-haiku', label: 'Haiku', args: '--model haiku' },
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
      ],
    },
    {
      id: 'features',
      label: 'Features',
      mode: 'multi',
      options: [
        { id: 'codex-search', label: 'Search', args: '--search' },
        { id: 'codex-no-alt-screen', label: 'Inline Scrollback', args: '--no-alt-screen' },
        { id: 'codex-oss', label: 'OSS Provider', args: '--oss' },
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
}

export function normalizeAgentCli(value: unknown): AgentCli {
  return value === 'codex' ? 'codex' : DEFAULT_AGENT_CLI
}

export function getArgsForAgent(agentCli: AgentCli, settings: AgentArgsSettings): string {
  return agentCli === 'codex' ? settings.codexArgs || '' : settings.claudeArgs || ''
}

export function buildAgentLaunchCommand(agentCli: AgentCli, args: string | undefined): string {
  const command = AGENT_CLI_COMMANDS[agentCli]
  const trimmed = (args || '').trim()
  return trimmed ? `${command} ${trimmed}\r` : `${command}\r`
}

export function stripResumeArgsForQuickLaunch(agentCli: AgentCli, args: string): string {
  let next = args
  if (agentCli === 'claude') {
    next = next.replace(/(^|\s)(--continue|-c)(?=\s|$)/g, ' ')
  } else {
    next = next.replace(/(^|\s)resume(\s+--last)?(?=\s|$)/g, ' ')
  }
  return next.replace(/\s+/g, ' ').trim()
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
