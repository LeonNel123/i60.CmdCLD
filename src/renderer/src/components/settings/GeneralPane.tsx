import { CheckboxRow, Field, PaneHeading, PillGroup, TextInput } from './controls'

export interface GeneralPaneProps {
  defaultViewMode: 'grid' | 'focused'
  onDefaultViewModeChange: (v: 'grid' | 'focused') => void
  askBeforeLaunch: boolean
  onAskBeforeLaunchChange: (v: boolean) => void
  notifyOnIdle: boolean
  onNotifyOnIdleChange: (v: boolean) => void
  restoreSessionEnabled: boolean
  onRestoreSessionEnabledChange: (v: boolean) => void
  restoreSessionResume: boolean
  onRestoreSessionResumeChange: (v: boolean) => void
  projectsRoot: string
  onProjectsRootChange: (v: string) => void
}

export function GeneralPane(p: GeneralPaneProps) {
  return (
    <div>
      <PaneHeading>General</PaneHeading>

      <Field label="Default View">
        <PillGroup
          value={p.defaultViewMode}
          onChange={p.onDefaultViewModeChange}
          options={[
            { value: 'grid', label: 'Grid (all terminals visible)' },
            { value: 'focused', label: 'Focused (one at a time)' },
          ]}
        />
      </Field>

      <CheckboxRow
        checked={p.askBeforeLaunch}
        onChange={p.onAskBeforeLaunchChange}
        label="Ask before launch (edit flags each time)"
      />

      <CheckboxRow
        checked={p.notifyOnIdle}
        onChange={p.onNotifyOnIdleChange}
        label="Play sound when terminal finishes work"
      />

      <CheckboxRow
        checked={p.restoreSessionEnabled}
        onChange={p.onRestoreSessionEnabledChange}
        label="Remember last session"
        hint='Track which projects you have open. On next launch, a "Welcome back" card lets you reopen them with one click. App startup is unaffected.'
      />
      <CheckboxRow
        indent={24}
        checked={p.restoreSessionResume}
        disabled={!p.restoreSessionEnabled}
        onChange={p.onRestoreSessionResumeChange}
        label="Resume conversations on reopen"
        hint="Adds --continue (Claude) / resume --last (Codex) when reopening, so each agent picks up its previous conversation."
      />

      <Field
        label='Projects Root (for "New Project")'
        hint='"New Project" creates a folder here and opens it in the app'
      >
        <div style={{ display: 'flex', gap: '6px' }}>
          <TextInput
            mono
            value={p.projectsRoot}
            onChange={(e) => p.onProjectsRootChange(e.target.value)}
            placeholder={window.api.platform === 'win32' ? 'e.g. D:\\Projects' : 'e.g. ~/Projects'}
            style={{ flex: 1, width: undefined }}
          />
          <button
            onClick={async () => {
              const folder = await window.api.selectFolder()
              if (folder) p.onProjectsRootChange(folder)
            }}
            style={{
              background: '#333', border: '1px solid #444', borderRadius: '4px',
              padding: '0 10px', color: '#999', fontSize: '11px', fontFamily: 'inherit',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            Browse
          </button>
        </div>
      </Field>
    </div>
  )
}
