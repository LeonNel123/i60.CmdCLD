import { CheckboxRow, EditableList, Field, INPUT_STYLE, MONO_FONT, PaneHeading } from './controls'
import type { TailscaleStatus } from './types'

export interface RemotePaneProps {
  remoteAccess: boolean
  onRemoteToggle: (enabled: boolean) => void
  remotePort: number
  onRemotePortChange: (v: number) => void
  remoteUrls: string[]
  remoteError: string
  tsStatus: TailscaleStatus | null
  tsBusy: boolean
  tsError: string
  onTailscaleServeToggle: (on: boolean) => void
  favoriteFolders: string[]
  onFavoriteFoldersChange: (folders: string[]) => void
}

export function RemotePane(p: RemotePaneProps) {
  const handleAddFavorite = async () => {
    const folder = await window.api.selectFolder()
    if (folder && !p.favoriteFolders.includes(folder)) {
      p.onFavoriteFoldersChange([...p.favoriteFolders, folder])
    }
  }

  return (
    <div>
      <PaneHeading>Remote Access</PaneHeading>

      <CheckboxRow
        checked={p.remoteAccess}
        onChange={p.onRemoteToggle}
        label="Enable Remote Access"
      />

      <Field label="Port">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={p.remotePort}
            onChange={(e) => p.onRemotePortChange(parseInt(e.target.value) || 3456)}
            disabled={p.remoteAccess}
            style={{
              ...INPUT_STYLE, width: '100px', padding: '6px 10px', fontFamily: MONO_FONT,
              opacity: p.remoteAccess ? 0.5 : 1,
            }}
          />
          {p.remoteAccess && (
            <span style={{ color: '#666', fontSize: '10px', fontFamily: 'inherit' }}>
              Disable to change port
            </span>
          )}
        </div>
      </Field>

      {p.remoteAccess && p.remoteUrls.length > 0 && (
        <Field label="Connect from" hint="Click to copy. Open in any browser on your network.">
          {p.remoteUrls.map((url) => (
            <div
              key={url}
              style={{ color: '#22c55e', fontSize: '12px', fontFamily: MONO_FONT, padding: '2px 0', cursor: 'pointer' }}
              onClick={() => navigator.clipboard.writeText(url)}
              title="Click to copy"
            >
              {url}
            </div>
          ))}
        </Field>
      )}

      {p.remoteError && (
        <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'inherit', marginBottom: '12px' }}>
          {p.remoteError}
        </div>
      )}

      {/* Tailscale HTTPS */}
      <div style={{ marginBottom: '16px', paddingTop: '12px', borderTop: '1px dashed #2a2a3a' }}>
        <div style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', marginBottom: '6px' }}>
          Tailscale HTTPS (optional)
        </div>
        {!p.tsStatus && (
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit' }}>Checking…</div>
        )}
        {p.tsStatus && !p.tsStatus.installed && (
          <div style={{ color: '#666', fontSize: '10px', fontFamily: 'inherit', lineHeight: 1.5 }}>
            Tailscale CLI not found. Install from{' '}
            <a
              href="https://tailscale.com/download"
              onClick={(e) => { e.preventDefault(); window.api.openExternal('https://tailscale.com/download', 'ui') }}
              style={{ color: '#22c55e' }}
            >tailscale.com/download</a>{' '}
            to expose CmdCLD over a trusted HTTPS URL without touching router settings.
          </div>
        )}
        {p.tsStatus?.installed && !p.tsStatus.loggedIn && (
          <div style={{ color: '#f59e0b', fontSize: '10px', fontFamily: 'inherit' }}>
            {p.tsStatus.error || 'Sign in with `tailscale up` and try again.'}
          </div>
        )}
        {p.tsStatus?.installed && p.tsStatus.loggedIn && (
          <>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              cursor: p.remoteAccess && !p.tsBusy ? 'pointer' : 'not-allowed',
              color: p.remoteAccess ? '#ccc' : '#666',
              fontSize: '12px', fontFamily: 'inherit',
            }}>
              <input
                type="checkbox"
                checked={!!p.tsStatus.serveActive}
                disabled={!p.remoteAccess || p.tsBusy}
                onChange={(e) => p.onTailscaleServeToggle(e.target.checked)}
                style={{ accentColor: '#22c55e' }}
              />
              Expose over HTTPS via Tailscale Serve
            </label>
            {!p.remoteAccess && (
              <div style={{ color: '#666', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px' }}>
                Enable Remote Access above first.
              </div>
            )}
            {p.tsStatus.serveActive && p.tsStatus.serveUrl && (
              <div
                style={{ color: '#22c55e', fontSize: '12px', fontFamily: MONO_FONT, padding: '4px 0', cursor: 'pointer' }}
                onClick={() => navigator.clipboard.writeText(p.tsStatus!.serveUrl!)}
                title="Click to copy"
              >
                {p.tsStatus.serveUrl}
              </div>
            )}
            <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px', lineHeight: 1.5 }}>
              Uses `tailscale serve --https=443`. Issues a Let's Encrypt cert on your tailnet name.
              Note: disabling runs `tailscale serve reset`, which clears all serve rules on this machine.
            </div>
            {p.tsError && (
              <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'inherit', marginTop: '6px' }}>
                {p.tsError}
              </div>
            )}
          </>
        )}
      </div>

      <Field label="Favorite Folders (for remote session creation)">
        <EditableList
          items={p.favoriteFolders}
          onChange={p.onFavoriteFoldersChange}
          addLabel="+ Add Folder"
          onRequestAdd={() => { void handleAddFavorite() }}
        />
      </Field>
    </div>
  )
}
