export const CLAUDE_PRESETS = [
  { label: 'Default (no flags)', args: '' },
  { label: 'Continue', args: '--continue' },
  { label: 'Skip Permissions', args: '--dangerously-skip-permissions' },
  { label: 'Skip + Continue', args: '--dangerously-skip-permissions --continue' },
  { label: 'Auto Mode', args: '--permission-mode auto' },
  { label: 'Accept Edits', args: '--permission-mode acceptEdits' },
  { label: 'Plan Mode', args: '--permission-mode plan' },
  { label: 'Opus + Skip', args: '--dangerously-skip-permissions --model opus' },
  { label: 'Sonnet + High Effort', args: '--model sonnet --effort high' },
  { label: 'Opus + Max Effort', args: '--model opus --effort max' },
  { label: 'Haiku (fast)', args: '--model haiku' },
]
