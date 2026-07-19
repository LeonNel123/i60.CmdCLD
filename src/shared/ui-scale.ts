// Interface scale — a proportional "Interface size" for the app UI CHROME
// (sidebar, dialogs, menus, welcome/empty screens). Applied via the
// `--ui-scale` CSS variable + the global `.ui-scaled` class (`zoom:var(--ui-scale)`).
//
// Scope: chrome surfaces ONLY. The terminal grid is never given the `.ui-scaled`
// class and is never inside a scaled ancestor, so terminals keep their own
// font/size regardless of this setting.
//
// Baseline: the chrome's base body text is ~12px, but a terminal renders its
// default at 12pt = 16px. So "Interface Size 100%" is defined to make the
// chrome match an open terminal's text — i.e. 100% applies a base zoom of
// 16/12, and the percentage scales around that. (Requested 2026-07-08.)

import { DEFAULT_TERMINAL_FONT_SIZE, pointsToPixels } from './terminal-font'

export const DEFAULT_UI_SCALE_PCT = 100
export const UI_SCALE_PCT_MIN = 50
export const UI_SCALE_PCT_MAX = 160
export const UI_SCALE_PCT_STEP = 10

// Chrome base body text size, and the base zoom that lifts it to terminal size.
const UI_CHROME_BASE_TEXT_PX = 12
export const UI_CHROME_BASE_SCALE = pointsToPixels(DEFAULT_TERMINAL_FONT_SIZE) / UI_CHROME_BASE_TEXT_PX

// Clamp an arbitrary (possibly non-integer / out-of-range / NaN) percent into
// the supported range, falling back to the default when not a number.
export function clampUiScalePct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_UI_SCALE_PCT
  return Math.min(Math.max(Math.round(pct), UI_SCALE_PCT_MIN), UI_SCALE_PCT_MAX)
}

// The user's raw percentage as a fraction (100 -> 1). Not the applied zoom.
export function uiScaleFactor(pct: number): number {
  return clampUiScalePct(pct) / 100
}

// The actual CSS zoom applied to chrome surfaces: the user's percentage times
// the base that makes 100% match the terminal (so 100% -> 16/12 ≈ 1.333). Used
// to set --ui-scale and for scale-aware measurements (sidebar drag-resize).
export function chromeScale(pct: number): number {
  return uiScaleFactor(pct) * UI_CHROME_BASE_SCALE
}
