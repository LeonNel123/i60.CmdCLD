// Single source of truth for the terminal font used by every xterm surface.
// Both the main-process settings defaults and the renderer's TerminalPanel
// import from here so the family/size literals can't drift apart.
//
// The default matches Windows Terminal's out-of-the-box look: "Cascadia Mono"
// (the ligature-free Cascadia variant) at 12pt. Cascadia Mono ships with
// Windows Terminal rather than the OS, so the stack falls back to the classic
// per-platform monospace faces (Menlo/Monaco on macOS, Consolas/Courier New on
// Windows) and finally the generic `monospace` keyword.
//
// IMPORTANT — UNITS:
//   Windows Terminal specifies its font size in POINTS. xterm.js's `fontSize`
//   option is in CSS PIXELS. Since 1pt = 1/72" and 1 CSS px = 1/96",
//   px = pt * 96/72 = pt * 4/3 (e.g. WT's 12pt = 16px).
//   We store and display the size in POINTS so the number matches Windows
//   Terminal exactly, and convert to pixels with `pointsToPixels()` at the one
//   boundary where the value is handed to xterm. Never pass a raw point value
//   to xterm's fontSize.

export const DEFAULT_TERMINAL_FONT_FAMILY =
  'Cascadia Mono, Menlo, Monaco, Consolas, "Courier New", monospace'

// Point size. 12pt matches Windows Terminal's default and renders as 16 CSS px.
export const DEFAULT_TERMINAL_FONT_SIZE = 12

// Bounds are in POINTS. 6pt ≈ 8px (small but legible) .. 32pt ≈ 43px (large).
// These bound both the settings UI and the keyboard zoom shortcuts.
export const TERMINAL_FONT_SIZE_MIN = 6
export const TERMINAL_FONT_SIZE_MAX = 32

// Points → CSS pixels. 96 DPI reference: px = pt * 96/72.
export const POINTS_TO_PIXELS = 96 / 72

// Convert a point size into the CSS pixel value xterm expects, rounded to a
// whole pixel for crisp cell metrics. This is the ONLY sanctioned pt→px
// boundary — every place that sets an xterm `fontSize` must go through it.
export function pointsToPixels(points: number): number {
  const pt = Number.isFinite(points) ? points : DEFAULT_TERMINAL_FONT_SIZE
  return Math.round(pt * POINTS_TO_PIXELS)
}

// Quick-pick font stacks offered in Settings. `value` is a full CSS
// font-family list so an unavailable first choice degrades gracefully.
export const TERMINAL_FONT_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Cascadia Mono (Windows Terminal default)', value: DEFAULT_TERMINAL_FONT_FAMILY },
  { label: 'Cascadia Code (ligatures)', value: 'Cascadia Code, Menlo, Monaco, Consolas, "Courier New", monospace' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Menlo, Consolas, monospace' },
  { label: 'Fira Code (ligatures)', value: '"Fira Code", Menlo, Consolas, monospace' },
  { label: 'Menlo / Monaco (macOS)', value: 'Menlo, Monaco, Consolas, monospace' },
]

// Clamp an arbitrary (possibly non-integer / out-of-range / NaN) POINT size
// into the supported range, falling back to the default when not a number.
export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(Math.max(Math.round(size), TERMINAL_FONT_SIZE_MIN), TERMINAL_FONT_SIZE_MAX)
}

// Resolve a stored family value, falling back to the default for empty/blank.
export function resolveTerminalFontFamily(family: string | undefined | null): string {
  if (typeof family === 'string' && family.trim()) return family
  return DEFAULT_TERMINAL_FONT_FAMILY
}
