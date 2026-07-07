// Interface (app UI chrome) font — separate from the terminal font in
// terminal-font.ts. Applied to <body> via the `--app-font-family` CSS variable,
// so everything that inherits (the bulk of the UI) follows it. Terminals are
// unaffected: xterm sets its own fontFamily explicitly.
//
// Default leads with Cascadia Mono (matching the terminals' look) and falls
// back to the app's original Inter / system-sans stack, so machines without
// Cascadia Mono simply keep the previous appearance.

export const DEFAULT_APP_FONT_FAMILY =
  'Cascadia Mono, Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'

// Quick-pick stacks for the settings dropdown. `value` is a full CSS
// font-family list so an unavailable first choice degrades gracefully.
export const APP_FONT_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Cascadia Mono (default)', value: DEFAULT_APP_FONT_FAMILY },
  { label: 'Cascadia Code (ligatures)', value: 'Cascadia Code, Inter, "Segoe UI", sans-serif' },
  { label: 'Inter (original UI font)', value: 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Segoe UI / System', value: '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
]

// Resolve a stored family value, falling back to the default for empty/blank.
export function resolveAppFontFamily(family: string | undefined | null): string {
  if (typeof family === 'string' && family.trim()) return family
  return DEFAULT_APP_FONT_FAMILY
}
