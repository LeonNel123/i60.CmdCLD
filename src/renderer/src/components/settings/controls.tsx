import { useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react'
import { X } from '../icons'

export const MONO_FONT = 'Menlo, Consolas, monospace'

export const INPUT_STYLE: CSSProperties = {
  background: '#0d1117',
  border: '1px solid #333',
  borderRadius: '4px',
  padding: '8px 10px',
  color: '#e0e0e0',
  fontSize: '12px',
  fontFamily: 'inherit',
  outline: 'none',
}

/** Pane title, e.g. "Appearance". Matches the old per-tab h3 styling. */
export function PaneHeading({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ color: '#e0e0e0', margin: '0 0 16px', fontSize: '14px', fontFamily: 'inherit', fontWeight: 600 }}>
      {children}
    </h3>
  )
}

/** Label + content + optional hint. The 16px bottom margin matches existing section spacing. */
export function Field({ label, hint, children }: { label?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      {label != null && (
        <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
          {label}
        </label>
      )}
      {children}
      {hint != null && (
        <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px', lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

/** Select-one pill row (agent CLI, view mode, permission mode, effort, model, provider…). */
export function PillGroup<T extends string>({ options, value, onChange, small }: {
  options: Array<{ value: T; label: ReactNode; title?: string }>
  value: T
  onChange: (v: T) => void
  /** 10px font + tighter padding, used by the Autopilot model quick-picks */
  small?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: small ? '4px' : '6px', flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.title}
            style={{
              background: active ? '#22c55e20' : '#ffffff08',
              border: active ? '1px solid #22c55e' : '1px solid #333',
              borderRadius: '4px',
              padding: small ? '3px 7px' : '4px 10px',
              color: active ? '#22c55e' : '#aaa',
              fontSize: small ? '10px' : '11px',
              fontFamily: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Dark input. Fills its container; pass style to override width. */
export function TextInput({ mono, style, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...rest}
      style={{
        ...INPUT_STYLE,
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: mono ? MONO_FONT : 'inherit',
        ...style,
      }}
    />
  )
}

/** The "− n +" control. Caller is responsible for clamping in onChange. */
export function NumberStepper({ value, onChange, min, max, step = 1, suffix, inputWidth = 52, title }: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  inputWidth?: number
  title?: string
}) {
  const btnStyle: CSSProperties = {
    background: '#333', border: '1px solid #444', borderRadius: '4px', width: '30px',
    color: '#ccc', fontSize: '14px', cursor: 'pointer', flexShrink: 0,
  }
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <button onClick={() => onChange(value - step)} title="Smaller" style={btnStyle}>−</button>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        title={title}
        style={{
          ...INPUT_STYLE, width: `${inputWidth}px`, padding: '8px 6px',
          textAlign: 'center', flexShrink: 0,
        }}
      />
      <button onClick={() => onChange(value + step)} title="Larger" style={btnStyle}>+</button>
      {suffix != null && (
        <span style={{ color: '#666', fontSize: '11px', fontFamily: 'inherit', flexShrink: 0 }}>{suffix}</span>
      )}
    </div>
  )
}

/** Checkbox + label, optional indented hint below, optional nesting indent. */
export function CheckboxRow({ checked, onChange, disabled, label, hint, indent }: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: ReactNode
  hint?: ReactNode
  /** left margin in px for nested rows (e.g. 24 for "Resume conversations") */
  indent?: number
}) {
  return (
    <div style={{ marginBottom: '12px', marginLeft: indent ? `${indent}px` : undefined }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#666' : '#ccc',
        fontSize: '12px', fontFamily: 'inherit',
      }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: '#22c55e' }}
        />
        {label}
      </label>
      {hint != null && (
        <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '2px', marginLeft: '24px', lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

/**
 * Add/remove list of strings (permission rules, favorite folders).
 * Inline mode (default): "+ addLabel" reveals a text input; Enter or Add commits, Escape cancels.
 * External mode (onRequestAdd set): "+ addLabel" calls onRequestAdd (e.g. a folder picker)
 * and no inline input is shown.
 * Adds are trimmed and deduped.
 */
export function EditableList({ items, onChange, addLabel, placeholder, emptyText, onRequestAdd }: {
  items: string[]
  onChange: (items: string[]) => void
  addLabel: string
  placeholder?: string
  emptyText?: string
  onRequestAdd?: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = () => {
    const v = draft.trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setDraft('')
    setAdding(false)
  }

  const addButton = (
    <button
      onClick={() => { if (onRequestAdd) onRequestAdd(); else { setDraft(''); setAdding(true) } }}
      style={{
        background: '#ffffff08', border: '1px solid #333', borderRadius: '4px', padding: '3px 8px',
        color: '#888', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', marginTop: '4px',
      }}
    >
      {addLabel}
    </button>
  )

  return (
    <div>
      {items.length === 0 && emptyText != null && (
        <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginBottom: '4px' }}>{emptyText}</div>
      )}
      {items.map((item, i) => (
        <div key={`${item}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
          <span style={{
            color: '#ccc', fontSize: '11px', fontFamily: MONO_FONT, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item}
          </span>
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{
              background: 'none', border: 'none', color: '#666', cursor: 'pointer',
              padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <X width={12} height={12} />
          </button>
        </div>
      ))}
      {!onRequestAdd && adding ? (
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setAdding(false) }}
            autoFocus
            placeholder={placeholder}
            style={{ ...INPUT_STYLE, flex: 1, padding: '4px 8px', fontSize: '11px', fontFamily: MONO_FONT }}
          />
          <button onClick={commit} style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>
            Add
          </button>
          <button onClick={() => setAdding(false)} style={{ background: '#333', color: '#999', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      ) : addButton}
    </div>
  )
}
