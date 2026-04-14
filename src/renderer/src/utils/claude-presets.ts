// Bypass-permissions presets are intentionally omitted: CmdCLD hardens the
// user-level Claude settings with `disableBypassPermissionsMode: "disable"`
// on startup, which makes `--dangerously-skip-permissions` error out.
export const CLAUDE_PRESETS = [
  { label: 'Default (no flags)', args: '' },
  { label: 'Continue', args: '--continue' },
  { label: 'Auto Mode', args: '--permission-mode auto' },
  { label: 'Plan Mode', args: '--permission-mode plan' },
  { label: 'Opus', args: '--model opus' },
  { label: 'Sonnet + High Effort', args: '--model sonnet --effort high' },
  { label: 'Opus + Max Effort', args: '--model opus --effort max' },
]
