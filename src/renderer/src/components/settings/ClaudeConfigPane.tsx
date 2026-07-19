import { CheckboxRow, EditableList, Field, MONO_FONT, PaneHeading, PillGroup, TextInput } from './controls'

export interface ClaudeConfigPaneProps {
  loaded: boolean
  disableBypass: boolean
  onDisableBypassChange: (v: boolean) => void
  defaultMode: string
  onDefaultModeChange: (v: string) => void
  effort: string
  onEffortChange: (v: string) => void
  model: string
  onModelChange: (v: string) => void
  autoUpdates: string
  onAutoUpdatesChange: (v: string) => void
  globalAllow: string[]
  onGlobalAllowChange: (v: string[]) => void
  globalDeny: string[]
  onGlobalDenyChange: (v: string[]) => void
  localAllow: string[]
  onLocalAllowChange: (v: string[]) => void
  localDeny: string[]
  onLocalDenyChange: (v: string[]) => void
}

function ScopeLabel({ title, path }: { title: string; path: string }) {
  return (
    <div style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', marginBottom: '10px' }}>
      {title} <span style={{ color: '#555', fontFamily: MONO_FONT }}>{path}</span>
    </div>
  )
}

export function ClaudeConfigPane(p: ClaudeConfigPaneProps) {
  if (!p.loaded) return null
  return (
    <div>
      <PaneHeading>Claude CLI Config</PaneHeading>

      <ScopeLabel title="Global Settings" path="~/.claude/settings.json" />

      <CheckboxRow
        checked={p.disableBypass}
        onChange={p.onDisableBypassChange}
        label="Disable bypass permissions mode"
        hint="Blocks --dangerously-skip-permissions and Shift+Tab bypass"
      />

      <Field label="Default Permission Mode">
        <PillGroup
          value={p.defaultMode}
          onChange={p.onDefaultModeChange}
          options={['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'].map((m) => ({ value: m, label: m }))}
        />
      </Field>

      <Field label="Effort Level">
        <PillGroup
          value={p.effort}
          onChange={p.onEffortChange}
          options={['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'].map((e) => ({ value: e, label: e }))}
        />
      </Field>

      <Field label="Model Override">
        <div style={{ marginBottom: '6px' }}>
          <PillGroup
            value={p.model}
            onChange={p.onModelChange}
            options={[
              { value: '', label: 'Default' },
              { value: 'claude-opus-4-8', label: 'Opus 4.8' },
              { value: 'claude-sonnet-5', label: 'Sonnet 5' },
              { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
              { value: 'claude-fable-5', label: 'Fable 5' },
            ]}
          />
        </div>
        <TextInput
          mono
          value={p.model}
          onChange={(e) => p.onModelChange(e.target.value)}
          placeholder="(default — no override)"
          style={{ padding: '6px 10px' }}
        />
      </Field>

      <Field label="Auto Updates Channel">
        <PillGroup
          value={p.autoUpdates}
          onChange={p.onAutoUpdatesChange}
          options={['latest', 'stable'].map((ch) => ({ value: ch, label: ch }))}
        />
      </Field>

      <Field label="Permission Allow Rules">
        <EditableList
          items={p.globalAllow}
          onChange={p.onGlobalAllowChange}
          addLabel="+ Add Rule"
          placeholder="e.g. Bash(npm:*)"
          emptyText="No rules"
        />
      </Field>

      <Field label="Permission Deny Rules">
        <EditableList
          items={p.globalDeny}
          onChange={p.onGlobalDenyChange}
          addLabel="+ Add Rule"
          placeholder="e.g. Bash(rm -rf:*)"
          emptyText="No rules"
        />
      </Field>

      <div style={{ borderTop: '1px solid #333', paddingTop: '16px' }}>
        <ScopeLabel title="Local Settings" path="~/.claude/settings.local.json" />

        <Field label="Permission Allow Rules">
          <EditableList
            items={p.localAllow}
            onChange={p.onLocalAllowChange}
            addLabel="+ Add Rule"
            placeholder="e.g. Bash(ssh:*)"
            emptyText="No rules"
          />
        </Field>

        <Field label="Permission Deny Rules">
          <EditableList
            items={p.localDeny}
            onChange={p.onLocalDenyChange}
            addLabel="+ Add Rule"
            placeholder="e.g. Bash(rm -rf:*)"
            emptyText="No rules"
          />
        </Field>
      </div>
    </div>
  )
}
