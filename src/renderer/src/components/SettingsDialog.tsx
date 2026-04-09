import { useState, useEffect } from 'react'
import { CLAUDE_PRESETS } from '../utils/claude-presets'

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [claudeArgs, setClaudeArgs] = useState('')
  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [defaultViewMode, setDefaultViewMode] = useState<'grid' | 'focused'>('grid')
  const [notifyOnIdle, setNotifyOnIdle] = useState(false)
  const [projectsRoot, setProjectsRoot] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [remoteAccess, setRemoteAccess] = useState(false)
  const [remotePort, setRemotePort] = useState(3456)
  const [remoteUrls, setRemoteUrls] = useState<string[]>([])
  const [remoteError, setRemoteError] = useState('')
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([])
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.api.getVersion().then(setAppVersion).catch(() => {})
    window.api.settingsGetAll().then((s) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
      setDefaultViewMode(s.defaultViewMode)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      setRemoteAccess(s.remoteAccess ?? false)
      setRemotePort(s.remotePort ?? 3456)
      setFavoriteFolders(s.favoriteFolders ?? [])
      setLoaded(true)
    })
    window.api.remoteStatus().then((status) => {
      if (status.running) {
        setRemoteAccess(true)
        if (status.urls?.length) setRemoteUrls(status.urls)
      }
    }).catch(() => {})
  }, [])

  const handleRemoteToggle = async (enabled: boolean) => {
    setRemoteError('')
    if (enabled) {
      window.api.settingsSet('remoteAccess', true)
      window.api.settingsSet('remotePort', remotePort)
      const result = await window.api.remoteToggle(true)
      if (result.ok) {
        setRemoteAccess(true)
        setRemoteUrls(result.urls || [])
      } else {
        setRemoteAccess(false)
        setRemoteError(result.error || 'Failed to start')
        window.api.settingsSet('remoteAccess', false)
      }
    } else {
      await window.api.remoteToggle(false)
      setRemoteAccess(false)
      setRemoteUrls([])
      window.api.settingsSet('remoteAccess', false)
    }
  }

  const handleAddFavorite = async () => {
    const folder = await window.api.selectFolder()
    if (folder && !favoriteFolders.includes(folder)) {
      setFavoriteFolders((prev) => [...prev, folder])
    }
  }

  const handleRemoveFavorite = (path: string) => {
    setFavoriteFolders((prev) => prev.filter((f) => f !== path))
  }

  const save = () => {
    window.api.settingsSet('claudeArgs', claudeArgs)
    window.api.settingsSet('askBeforeLaunch', askBeforeLaunch)
    window.api.settingsSet('defaultViewMode', defaultViewMode)
    window.api.settingsSet('notifyOnIdle', notifyOnIdle)
    window.api.settingsSet('projectsRoot', projectsRoot)
    window.api.settingsSet('remotePort', remotePort)
    window.api.settingsSet('favoriteFolders', favoriteFolders)
    onClose()
  }

  if (!loaded) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 3000,
    }}
    onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a2e',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '520px',
          width: '90%',
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid #333',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 16px 0' }}>
          <h3 style={{ color: '#e0e0e0', margin: 0, fontSize: '14px', fontFamily: 'monospace' }}>
            Claude CLI Settings
          </h3>
          {appVersion && (
            <span style={{ color: '#555', fontSize: '11px', fontFamily: 'monospace' }}>
              v{appVersion}
            </span>
          )}
        </div>

        {/* Presets */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Quick Presets
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {CLAUDE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setClaudeArgs(p.args)}
                style={{
                  background: claudeArgs === p.args ? '#22c55e20' : '#ffffff08',
                  border: claudeArgs === p.args ? '1px solid #22c55e' : '1px solid #333',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  color: claudeArgs === p.args ? '#22c55e' : '#aaa',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Args text field */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Default Launch Arguments
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={claudeArgs}
              onChange={(e) => setClaudeArgs(e.target.value)}
              placeholder="e.g. --dangerously-skip-permissions --continue"
              style={{
                flex: 1,
                background: '#0d1117',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '8px 10px',
                color: '#e0e0e0',
                fontSize: '12px',
                fontFamily: 'Menlo, Consolas, monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={() => setClaudeArgs('')}
              title="Clear"
              style={{
                background: '#333',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '0 10px',
                color: '#999',
                fontSize: '11px',
                fontFamily: 'monospace',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Clear
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>
            These flags are passed to `claude` when opening a new terminal
          </div>
        </div>

        {/* Ask before launch toggle */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            color: '#ccc',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}>
            <input
              type="checkbox"
              checked={askBeforeLaunch}
              onChange={(e) => setAskBeforeLaunch(e.target.checked)}
              style={{ accentColor: '#22c55e' }}
            />
            Ask before launch (edit flags each time)
          </label>
        </div>

        {/* Default view mode */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Default View
          </label>
          <div style={{ display: 'flex', gap: '4px' }}>
            {([
              { value: 'grid' as const, label: 'Grid (all terminals visible)' },
              { value: 'focused' as const, label: 'Focused (one at a time)' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDefaultViewMode(opt.value)}
                style={{
                  background: defaultViewMode === opt.value ? '#22c55e20' : '#ffffff08',
                  border: defaultViewMode === opt.value ? '1px solid #22c55e' : '1px solid #333',
                  borderRadius: '4px',
                  padding: '4px 10px',
                  color: defaultViewMode === opt.value ? '#22c55e' : '#aaa',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notification on idle */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'monospace',
          }}>
            <input
              type="checkbox"
              checked={notifyOnIdle}
              onChange={(e) => setNotifyOnIdle(e.target.checked)}
              style={{ accentColor: '#22c55e' }}
            />
            Play sound when terminal finishes work
          </label>
        </div>

        {/* Projects root */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
            Projects Root (for "New Project")
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={projectsRoot}
              onChange={(e) => setProjectsRoot(e.target.value)}
              placeholder={window.api.platform === 'win32' ? 'e.g. D:\\Projects' : 'e.g. ~/Projects'}
              style={{
                flex: 1, background: '#0d1117', border: '1px solid #333',
                borderRadius: '4px', padding: '8px 10px', color: '#e0e0e0',
                fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none',
              }}
            />
            <button
              onClick={async () => {
                const p = await window.api.selectFolder()
                if (p) setProjectsRoot(p)
              }}
              style={{
                background: '#333', border: '1px solid #444', borderRadius: '4px',
                padding: '0 10px', color: '#999', fontSize: '11px', fontFamily: 'monospace',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              Browse
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>
            "New Project" creates a folder here and opens it in the app
          </div>
        </div>

        {/* Remote Access */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '16px', marginTop: '16px' }}>
          <h4 style={{ color: '#e0e0e0', margin: '0 0 12px', fontSize: '13px', fontFamily: 'monospace' }}>
            Remote Access
          </h4>

          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'monospace',
            }}>
              <input
                type="checkbox"
                checked={remoteAccess}
                onChange={(e) => handleRemoteToggle(e.target.checked)}
                style={{ accentColor: '#22c55e' }}
              />
              Enable Remote Access
            </label>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
              Port
            </label>
            <input
              type="number"
              value={remotePort}
              onChange={(e) => setRemotePort(parseInt(e.target.value) || 3456)}
              disabled={remoteAccess}
              style={{
                width: '100px', background: '#0d1117', border: '1px solid #333',
                borderRadius: '4px', padding: '6px 10px', color: '#e0e0e0',
                fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none',
                opacity: remoteAccess ? 0.5 : 1,
              }}
            />
            {remoteAccess && (
              <span style={{ color: '#666', fontSize: '10px', fontFamily: 'monospace', marginLeft: '8px' }}>
                Disable to change port
              </span>
            )}
          </div>

          {remoteAccess && remoteUrls.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
                Connect from
              </label>
              {remoteUrls.map((url) => (
                <div key={url} style={{
                  color: '#22c55e', fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace',
                  padding: '2px 0', cursor: 'pointer',
                }} onClick={() => navigator.clipboard.writeText(url)} title="Click to copy">
                  {url}
                </div>
              ))}
              <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>
                Click to copy. Open in any browser on your network.
              </div>
            </div>
          )}

          {remoteError && (
            <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'monospace', marginBottom: '12px' }}>
              {remoteError}
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', display: 'block', marginBottom: '6px' }}>
              Favorite Folders (for remote session creation)
            </label>
            {favoriteFolders.map((f) => (
              <div key={f} style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0',
              }}>
                <span style={{ color: '#ccc', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f}
                </span>
                <button onClick={() => handleRemoveFavorite(f)} style={{
                  background: 'none', border: 'none', color: '#666', cursor: 'pointer',
                  fontSize: '14px', padding: '0 4px', flexShrink: 0,
                }}>×</button>
              </div>
            ))}
            <button onClick={handleAddFavorite} style={{
              background: '#ffffff08', border: '1px solid #333', borderRadius: '4px',
              padding: '4px 10px', color: '#888', fontSize: '11px', fontFamily: 'monospace',
              cursor: 'pointer', marginTop: '4px',
            }}>
              + Add Folder
            </button>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: '#333', color: '#ccc', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'monospace',
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              background: '#22c55e', color: '#000', border: 'none',
              borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'monospace', fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
