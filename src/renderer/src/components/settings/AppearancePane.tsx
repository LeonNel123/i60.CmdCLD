import type { ReactNode } from 'react'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_PRESETS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  clampTerminalFontSize,
  pointsToPixels,
  resolveTerminalFontFamily,
} from '../../../../shared/terminal-font'
import { APP_FONT_PRESETS, DEFAULT_APP_FONT_FAMILY, resolveAppFontFamily } from '../../../../shared/app-font'
import { UI_SCALE_PCT_MAX, UI_SCALE_PCT_MIN, UI_SCALE_PCT_STEP, clampUiScalePct } from '../../../../shared/ui-scale'
import { Field, INPUT_STYLE, NumberStepper, PaneHeading, TextInput } from './controls'

export interface AppearancePaneProps {
  terminalFontFamily: string
  onTerminalFontFamilyChange: (v: string) => void
  terminalFontSize: number
  onTerminalFontSizeChange: (v: number) => void
  appFontFamily: string
  onAppFontFamilyChange: (v: string) => void
  uiScalePct: number
  onUiScalePctChange: (v: number) => void
}

function FontPicker({ presets, value, onChange, placeholder, extraControls, preview }: {
  presets: ReadonlyArray<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** rendered to the right of the preset select (terminal font size stepper) */
  extraControls?: ReactNode
  preview: ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
        <select
          value={presets.some((p) => p.value === value) ? value : '__custom__'}
          onChange={(e) => { if (e.target.value !== '__custom__') onChange(e.target.value) }}
          style={{ ...INPUT_STYLE, flex: 1 }}
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          <option value="__custom__">Custom…</option>
        </select>
        {extraControls}
      </div>
      <TextInput
        mono
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{ marginBottom: '6px' }}
      />
      {preview}
    </div>
  )
}

const PREVIEW_BOX: React.CSSProperties = {
  background: '#1e1e1e',
  border: '1px solid #333',
  borderRadius: '4px',
  padding: '8px 10px',
  color: '#cccccc',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export function AppearancePane(p: AppearancePaneProps) {
  const mod = window.api.platform === 'darwin' ? '⌘' : 'Ctrl'
  return (
    <div>
      <PaneHeading>Appearance</PaneHeading>

      <Field
        label="Terminal Font"
        hint={<>
          Size is in points, matching Windows Terminal ({clampTerminalFontSize(p.terminalFontSize)} pt ≈ {pointsToPixels(clampTerminalFontSize(p.terminalFontSize))} px).
          Applies to all terminals. Zoom any terminal live with {mod} + / {mod} −, reset with {mod} 0.
        </>}
      >
        <FontPicker
          presets={TERMINAL_FONT_PRESETS}
          value={p.terminalFontFamily}
          onChange={p.onTerminalFontFamilyChange}
          placeholder={DEFAULT_TERMINAL_FONT_FAMILY}
          extraControls={
            <NumberStepper
              value={p.terminalFontSize}
              onChange={(v) => p.onTerminalFontSizeChange(clampTerminalFontSize(v))}
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              suffix="pt"
              title="Font size in points (matches Windows Terminal)"
            />
          }
          preview={
            <div style={{
              ...PREVIEW_BOX,
              fontFamily: resolveTerminalFontFamily(p.terminalFontFamily),
              fontSize: `${pointsToPixels(clampTerminalFontSize(p.terminalFontSize))}px`,
              lineHeight: 1.4,
            }}>
              {'The quick brown fox  0O1lI|  => != >=  {}[]()'}
            </div>
          }
        />
      </Field>

      <Field
        label="Interface Font"
        hint="Font for the app interface (sidebar, dialogs, menus). Terminals use the Terminal Font above. Applies when you save."
      >
        <FontPicker
          presets={APP_FONT_PRESETS}
          value={p.appFontFamily}
          onChange={p.onAppFontFamilyChange}
          placeholder={DEFAULT_APP_FONT_FAMILY}
          preview={
            <div style={{
              ...PREVIEW_BOX,
              fontFamily: resolveAppFontFamily(p.appFontFamily),
              fontSize: '13px',
              lineHeight: 1.5,
            }}>
              {'The quick brown fox — Sidebar, dialogs, buttons. 0123456789'}
            </div>
          }
        />
      </Field>

      <Field
        label="Interface Size"
        hint="Scales the interface so text and controls grow together (this first cut scales the sidebar). Terminals are never affected. Applies when you save."
      >
        <NumberStepper
          value={p.uiScalePct}
          onChange={(v) => p.onUiScalePctChange(clampUiScalePct(v))}
          min={UI_SCALE_PCT_MIN}
          max={UI_SCALE_PCT_MAX}
          step={UI_SCALE_PCT_STEP}
          suffix="%"
          inputWidth={64}
          title="Interface size (percent)"
        />
      </Field>
    </div>
  )
}
