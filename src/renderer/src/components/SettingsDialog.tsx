import { useState, useEffect } from 'react'
import { CLAUDE_PRESETS } from '../utils/claude-presets'
import { X } from './icons'

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<'settings' | 'claude config' | 'about'>('settings')
  const [claudeArgs, setClaudeArgs] = useState('')
  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [defaultViewMode, setDefaultViewMode] = useState<'grid' | 'focused'>('grid')
  const [notifyOnIdle, setNotifyOnIdle] = useState(false)
  const [restoreSessionEnabled, setRestoreSessionEnabled] = useState(false)
  const [projectsRoot, setProjectsRoot] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [remoteAccess, setRemoteAccess] = useState(false)
  const [remotePort, setRemotePort] = useState(3456)
  const [remoteUrls, setRemoteUrls] = useState<string[]>([])
  const [remoteError, setRemoteError] = useState('')
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([])
  const [tsStatus, setTsStatus] = useState<{
    installed: boolean
    loggedIn: boolean
    online: boolean
    httpsEnabled: boolean
    httpsHost: string | null
    error: string | null
    serveActive: boolean
    serveUrl: string | null
  } | null>(null)
  const [tsBusy, setTsBusy] = useState(false)
  const [tsError, setTsError] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [buildInfo, setBuildInfo] = useState<{ electron: string; chrome: string; node: string; platform: string; release: string } | null>(null)

  // Claude Config tab state
  const [ccDisableBypass, setCcDisableBypass] = useState(false)
  const [ccDefaultMode, setCcDefaultMode] = useState('default')
  const [ccEffort, setCcEffort] = useState('')
  const [ccModel, setCcModel] = useState('')
  const [ccAutoUpdates, setCcAutoUpdates] = useState('')
  const [ccGlobalAllow, setCcGlobalAllow] = useState<string[]>([])
  const [ccGlobalDeny, setCcGlobalDeny] = useState<string[]>([])
  const [ccLocalAllow, setCcLocalAllow] = useState<string[]>([])
  const [ccLocalDeny, setCcLocalDeny] = useState<string[]>([])
  const [ccNewRule, setCcNewRule] = useState('')
  const [ccAddTarget, setCcAddTarget] = useState<'global-allow' | 'global-deny' | 'local-allow' | 'local-deny' | null>(null)
  const [ccLoaded, setCcLoaded] = useState(false)
  const [ccSaved, setCcSaved] = useState(false)

  useEffect(() => {
    window.api.getVersion().then(setAppVersion).catch(() => {})
    window.api.getBuildInfo().then(setBuildInfo).catch(() => {})
    window.api.settingsGetAll().then((s) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
      setDefaultViewMode(s.defaultViewMode)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      setRemoteAccess(s.remoteAccess ?? false)
      setRemotePort(s.remotePort ?? 3456)
      setFavoriteFolders(s.favoriteFolders ?? [])
      setRestoreSessionEnabled(s.restoreSessionEnabled ?? false)
      setLoaded(true)
    })
    window.api.claudeConfigRead().then((cfg) => {
      const g = cfg.global as any
      const l = cfg.local as any
      const gp = g.permissions || {}
      const lp = l.permissions || {}
      setCcDisableBypass(gp.disableBypassPermissionsMode === 'disable')
      setCcDefaultMode(gp.defaultMode || 'default')
      setCcEffort(g.effortLevel || '')
      setCcModel(g.model || '')
      setCcAutoUpdates(g.autoUpdatesChannel || '')
      setCcGlobalAllow(Array.isArray(gp.allow) ? gp.allow : [])
      setCcGlobalDeny(Array.isArray(gp.deny) ? gp.deny : [])
      setCcLocalAllow(Array.isArray(lp.allow) ? lp.allow : [])
      setCcLocalDeny(Array.isArray(lp.deny) ? lp.deny : [])
      setCcLoaded(true)
    }).catch(() => setCcLoaded(true))
    window.api.remoteStatus().then((status) => {
      if (status.running) {
        setRemoteAccess(true)
        if (status.urls?.length) setRemoteUrls(status.urls)
      }
    }).catch(() => {})
    window.api.tailscaleStatus().then(setTsStatus).catch(() => {})
  }, [])

  const refreshTailscale = async () => {
    try {
      const s = await window.api.tailscaleStatus()
      setTsStatus(s)
    } catch {
      // ignore
    }
  }

  const handleTailscaleServeToggle = async (on: boolean) => {
    setTsError('')
    setTsBusy(true)
    try {
      const result = on ? await window.api.tailscaleServeStart() : await window.api.tailscaleServeStop()
      if (!result.ok) setTsError(result.error || (on ? 'Failed to start' : 'Failed to stop'))
      await refreshTailscale()
    } finally {
      setTsBusy(false)
    }
  }

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
      // Tailscale serve points at the local HTTP server; stop it too so we
      // don't leave a broken HTTPS URL behind after disabling remote access.
      if (tsStatus?.serveActive) {
        await window.api.tailscaleServeStop().catch(() => {})
        await refreshTailscale()
      }
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
    window.api.settingsSet('restoreSessionEnabled', restoreSessionEnabled)
    if (!restoreSessionEnabled) {
      // Clear the saved file so the next launch behaves like a fresh install.
      window.api.sessionClearLast().catch(() => {})
    }
    onClose()
  }

  const saveClaudeConfig = () => {
    const globalPerms: Record<string, unknown> = {
      allow: ccGlobalAllow,
      deny: ccGlobalDeny.length > 0 ? ccGlobalDeny : undefined,
    }
    if (ccDisableBypass) globalPerms.disableBypassPermissionsMode = 'disable'
    if (ccDefaultMode && ccDefaultMode !== 'default') globalPerms.defaultMode = ccDefaultMode

    const globalData: Record<string, unknown> = { permissions: globalPerms }
    if (ccEffort) globalData.effortLevel = ccEffort
    if (ccModel) globalData.model = ccModel
    else globalData.model = undefined
    if (ccAutoUpdates) globalData.autoUpdatesChannel = ccAutoUpdates

    window.api.claudeConfigWrite('global', globalData)

    const localPerms: Record<string, unknown> = {
      allow: ccLocalAllow,
    }
    if (ccLocalDeny.length > 0) localPerms.deny = ccLocalDeny
    window.api.claudeConfigWrite('local', { permissions: localPerms })

    setCcSaved(true)
    setTimeout(() => setCcSaved(false), 2000)
  }

  const handleAddRule = (target: 'global-allow' | 'global-deny' | 'local-allow' | 'local-deny') => {
    const rule = ccNewRule.trim()
    if (!rule) return
    if (target === 'global-allow' && !ccGlobalAllow.includes(rule)) setCcGlobalAllow([...ccGlobalAllow, rule])
    if (target === 'global-deny' && !ccGlobalDeny.includes(rule)) setCcGlobalDeny([...ccGlobalDeny, rule])
    if (target === 'local-allow' && !ccLocalAllow.includes(rule)) setCcLocalAllow([...ccLocalAllow, rule])
    if (target === 'local-deny' && !ccLocalDeny.includes(rule)) setCcLocalDeny([...ccLocalDeny, rule])
    setCcNewRule('')
    setCcAddTarget(null)
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
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
          {(['settings', 'claude config', 'about'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? '#22c55e20' : '#ffffff08',
                border: tab === t ? '1px solid #22c55e' : '1px solid #333',
                borderRadius: '4px',
                padding: '4px 12px',
                color: tab === t ? '#22c55e' : '#aaa',
                fontSize: '11px',
                fontFamily: 'inherit',
                cursor: 'pointer',
                textTransform: 'capitalize',
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'settings' && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 16px 0' }}>
          <h3 style={{ color: '#e0e0e0', margin: 0, fontSize: '14px', fontFamily: 'inherit', fontWeight: 600 }}>
            Claude CLI Settings
          </h3>
          {appVersion && (
            <span style={{ color: '#555', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace' }}>
              v{appVersion}
            </span>
          )}
        </div>
        )}

        {tab === 'settings' && (<>

        {/* Presets */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
                  fontFamily: 'inherit',
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
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
                fontFamily: 'inherit',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Clear
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px' }}>
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
            fontFamily: 'inherit',
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
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
                  fontFamily: 'inherit',
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
            cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'inherit',
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

        {/* Remember last session */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'inherit',
          }}>
            <input
              type="checkbox"
              checked={restoreSessionEnabled}
              onChange={(e) => setRestoreSessionEnabled(e.target.checked)}
              style={{ accentColor: '#22c55e' }}
            />
            Remember last session
          </label>
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '2px', marginLeft: '24px', lineHeight: 1.4 }}>
            Track which projects you have open. On next launch, a "Welcome back" card lets you reopen them with one click. App startup is unaffected.
          </div>
        </div>

        {/* Projects root */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
                padding: '0 10px', color: '#999', fontSize: '11px', fontFamily: 'inherit',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              Browse
            </button>
          </div>
          <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px' }}>
            "New Project" creates a folder here and opens it in the app
          </div>
        </div>

        {/* Remote Access */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '16px', marginTop: '16px' }}>
          <h4 style={{ color: '#e0e0e0', margin: '0 0 12px', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600 }}>
            Remote Access
          </h4>

          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'inherit',
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
            <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
              <span style={{ color: '#666', fontSize: '10px', fontFamily: 'inherit', marginLeft: '8px' }}>
                Disable to change port
              </span>
            )}
          </div>

          {remoteAccess && remoteUrls.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
              <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px' }}>
                Click to copy. Open in any browser on your network.
              </div>
            </div>
          )}

          {remoteError && (
            <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'inherit', marginBottom: '12px' }}>
              {remoteError}
            </div>
          )}

          {/* Tailscale HTTPS */}
          <div style={{ marginBottom: '16px', paddingTop: '12px', borderTop: '1px dashed #2a2a3a' }}>
            <div style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', marginBottom: '6px' }}>
              Tailscale HTTPS (optional)
            </div>
            {!tsStatus && (
              <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit' }}>Checking…</div>
            )}
            {tsStatus && !tsStatus.installed && (
              <div style={{ color: '#666', fontSize: '10px', fontFamily: 'inherit', lineHeight: 1.5 }}>
                Tailscale CLI not found. Install from{' '}
                <a
                  href="https://tailscale.com/download"
                  onClick={(e) => { e.preventDefault(); window.api.openExternal('https://tailscale.com/download') }}
                  style={{ color: '#22c55e' }}
                >tailscale.com/download</a>{' '}
                to expose CmdCLD over a trusted HTTPS URL without touching router settings.
              </div>
            )}
            {tsStatus?.installed && !tsStatus.loggedIn && (
              <div style={{ color: '#f59e0b', fontSize: '10px', fontFamily: 'inherit' }}>
                {tsStatus.error || 'Sign in with `tailscale up` and try again.'}
              </div>
            )}
            {tsStatus?.installed && tsStatus.loggedIn && (
              <>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  cursor: remoteAccess && !tsBusy ? 'pointer' : 'not-allowed',
                  color: remoteAccess ? '#ccc' : '#666',
                  fontSize: '12px', fontFamily: 'inherit',
                }}>
                  <input
                    type="checkbox"
                    checked={!!tsStatus.serveActive}
                    disabled={!remoteAccess || tsBusy}
                    onChange={(e) => handleTailscaleServeToggle(e.target.checked)}
                    style={{ accentColor: '#22c55e' }}
                  />
                  Expose over HTTPS via Tailscale Serve
                </label>
                {!remoteAccess && (
                  <div style={{ color: '#666', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px' }}>
                    Enable Remote Access above first.
                  </div>
                )}
                {tsStatus.serveActive && tsStatus.serveUrl && (
                  <div
                    style={{
                      color: '#22c55e', fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace',
                      padding: '4px 0', cursor: 'pointer',
                    }}
                    onClick={() => navigator.clipboard.writeText(tsStatus.serveUrl!)}
                    title="Click to copy"
                  >
                    {tsStatus.serveUrl}
                  </div>
                )}
                <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '4px', lineHeight: 1.5 }}>
                  Uses `tailscale serve --https=443`. Issues a Let's Encrypt cert on your tailnet name.
                  Note: disabling runs `tailscale serve reset`, which clears all serve rules on this machine.
                </div>
                {tsError && (
                  <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'inherit', marginTop: '6px' }}>
                    {tsError}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '6px' }}>
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
                  padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                }}>
                  <X width={12} height={12} />
                </button>
              </div>
            ))}
            <button onClick={handleAddFavorite} style={{
              background: '#ffffff08', border: '1px solid #333', borderRadius: '4px',
              padding: '4px 10px', color: '#888', fontSize: '11px', fontFamily: 'inherit',
              cursor: 'pointer', marginTop: '4px',
            }}>
              + Add Folder
            </button>
          </div>
        </div>

        </>)}

        {/* Claude Config tab */}
        {tab === 'claude config' && ccLoaded && (<>
          <h3 style={{ color: '#e0e0e0', margin: '0 0 16px', fontSize: '14px', fontFamily: 'inherit', fontWeight: 600 }}>
            Claude CLI Config
          </h3>

          {/* Global Settings */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', marginBottom: '10px' }}>
              Global Settings <span style={{ color: '#555', fontFamily: 'Menlo, Consolas, monospace' }}>~/.claude/settings.json</span>
            </div>

            {/* Disable Bypass */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#ccc', fontSize: '12px', fontFamily: 'inherit' }}>
                <input type="checkbox" checked={ccDisableBypass} onChange={(e) => setCcDisableBypass(e.target.checked)} style={{ accentColor: '#22c55e' }} />
                Disable bypass permissions mode
              </label>
              <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginTop: '2px', marginLeft: '24px' }}>
                Blocks --dangerously-skip-permissions and Shift+Tab bypass
              </div>
            </div>

            {/* Default Mode */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Default Permission Mode
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'].map((m) => (
                  <button key={m} onClick={() => setCcDefaultMode(m)} style={{
                    background: ccDefaultMode === m ? '#22c55e20' : '#ffffff08',
                    border: ccDefaultMode === m ? '1px solid #22c55e' : '1px solid #333',
                    borderRadius: '4px', padding: '3px 8px',
                    color: ccDefaultMode === m ? '#22c55e' : '#aaa',
                    fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer',
                  }}>{m}</button>
                ))}
              </div>
            </div>

            {/* Effort Level */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Effort Level
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['low', 'medium', 'high'].map((e) => (
                  <button key={e} onClick={() => setCcEffort(e)} style={{
                    background: ccEffort === e ? '#22c55e20' : '#ffffff08',
                    border: ccEffort === e ? '1px solid #22c55e' : '1px solid #333',
                    borderRadius: '4px', padding: '4px 10px',
                    color: ccEffort === e ? '#22c55e' : '#aaa',
                    fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer',
                  }}>{e}</button>
                ))}
              </div>
            </div>

            {/* Model Override */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Model Override
              </label>
              <input type="text" value={ccModel} onChange={(e) => setCcModel(e.target.value)}
                placeholder="(default — no override)"
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#0d1117', border: '1px solid #333',
                  borderRadius: '4px', padding: '6px 10px', color: '#e0e0e0',
                  fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none',
                }} />
            </div>

            {/* Auto Updates Channel */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Auto Updates Channel
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['latest', 'stable'].map((ch) => (
                  <button key={ch} onClick={() => setCcAutoUpdates(ch)} style={{
                    background: ccAutoUpdates === ch ? '#22c55e20' : '#ffffff08',
                    border: ccAutoUpdates === ch ? '1px solid #22c55e' : '1px solid #333',
                    borderRadius: '4px', padding: '4px 10px',
                    color: ccAutoUpdates === ch ? '#22c55e' : '#aaa',
                    fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer',
                  }}>{ch}</button>
                ))}
              </div>
            </div>

            {/* Global Allow rules */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Permission Allow Rules
              </label>
              {ccGlobalAllow.length === 0 && (
                <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginBottom: '4px' }}>No rules</div>
              )}
              {ccGlobalAllow.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ color: '#ccc', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                  <button onClick={() => setCcGlobalAllow(ccGlobalAllow.filter((_, j) => j !== i))} style={{
                    background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                  }}>
                    <X width={12} height={12} />
                  </button>
                </div>
              ))}
              {ccAddTarget === 'global-allow' ? (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input type="text" value={ccNewRule} onChange={(e) => setCcNewRule(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddRule('global-allow'); if (e.key === 'Escape') setCcAddTarget(null) }}
                    autoFocus placeholder='e.g. Bash(npm:*)'
                    style={{ flex: 1, background: '#0d1117', border: '1px solid #333', borderRadius: '4px', padding: '4px 8px', color: '#e0e0e0', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none' }} />
                  <button onClick={() => handleAddRule('global-allow')} style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setCcAddTarget(null)} style={{ background: '#333', color: '#999', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setCcNewRule(''); setCcAddTarget('global-allow') }} style={{
                  background: '#ffffff08', border: '1px solid #333', borderRadius: '4px', padding: '3px 8px',
                  color: '#888', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', marginTop: '4px',
                }}>+ Add Rule</button>
              )}
            </div>

            {/* Global Deny rules */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Permission Deny Rules
              </label>
              {ccGlobalDeny.length === 0 && (
                <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginBottom: '4px' }}>No rules</div>
              )}
              {ccGlobalDeny.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ color: '#ccc', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                  <button onClick={() => setCcGlobalDeny(ccGlobalDeny.filter((_, j) => j !== i))} style={{
                    background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                  }}>
                    <X width={12} height={12} />
                  </button>
                </div>
              ))}
              {ccAddTarget === 'global-deny' ? (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input type="text" value={ccNewRule} onChange={(e) => setCcNewRule(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddRule('global-deny'); if (e.key === 'Escape') setCcAddTarget(null) }}
                    autoFocus placeholder='e.g. Bash(rm -rf:*)'
                    style={{ flex: 1, background: '#0d1117', border: '1px solid #333', borderRadius: '4px', padding: '4px 8px', color: '#e0e0e0', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none' }} />
                  <button onClick={() => handleAddRule('global-deny')} style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setCcAddTarget(null)} style={{ background: '#333', color: '#999', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setCcNewRule(''); setCcAddTarget('global-deny') }} style={{
                  background: '#ffffff08', border: '1px solid #333', borderRadius: '4px', padding: '3px 8px',
                  color: '#888', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', marginTop: '4px',
                }}>+ Add Rule</button>
              )}
            </div>
          </div>

          {/* Local Settings */}
          <div style={{ borderTop: '1px solid #333', paddingTop: '16px' }}>
            <div style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', marginBottom: '10px' }}>
              Local Settings <span style={{ color: '#555', fontFamily: 'Menlo, Consolas, monospace' }}>~/.claude/settings.local.json</span>
            </div>

            {/* Local Allow rules */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Permission Allow Rules
              </label>
              {ccLocalAllow.length === 0 && (
                <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginBottom: '4px' }}>No rules</div>
              )}
              {ccLocalAllow.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ color: '#ccc', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                  <button onClick={() => setCcLocalAllow(ccLocalAllow.filter((_, j) => j !== i))} style={{
                    background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                  }}>
                    <X width={12} height={12} />
                  </button>
                </div>
              ))}
              {ccAddTarget === 'local-allow' ? (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input type="text" value={ccNewRule} onChange={(e) => setCcNewRule(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddRule('local-allow'); if (e.key === 'Escape') setCcAddTarget(null) }}
                    autoFocus placeholder='e.g. Bash(ssh:*)'
                    style={{ flex: 1, background: '#0d1117', border: '1px solid #333', borderRadius: '4px', padding: '4px 8px', color: '#e0e0e0', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none' }} />
                  <button onClick={() => handleAddRule('local-allow')} style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setCcAddTarget(null)} style={{ background: '#333', color: '#999', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setCcNewRule(''); setCcAddTarget('local-allow') }} style={{
                  background: '#ffffff08', border: '1px solid #333', borderRadius: '4px', padding: '3px 8px',
                  color: '#888', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', marginTop: '4px',
                }}>+ Add Rule</button>
              )}
            </div>

            {/* Local Deny rules */}
            <div style={{ marginBottom: '10px' }}>
              <label style={{ color: '#888', fontSize: '11px', fontFamily: 'inherit', display: 'block', marginBottom: '4px' }}>
                Permission Deny Rules
              </label>
              {ccLocalDeny.length === 0 && (
                <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', marginBottom: '4px' }}>No rules</div>
              )}
              {ccLocalDeny.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ color: '#ccc', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                  <button onClick={() => setCcLocalDeny(ccLocalDeny.filter((_, j) => j !== i))} style={{
                    background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                  }}>
                    <X width={12} height={12} />
                  </button>
                </div>
              ))}
              {ccAddTarget === 'local-deny' ? (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input type="text" value={ccNewRule} onChange={(e) => setCcNewRule(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddRule('local-deny'); if (e.key === 'Escape') setCcAddTarget(null) }}
                    autoFocus placeholder='e.g. Bash(rm -rf:*)'
                    style={{ flex: 1, background: '#0d1117', border: '1px solid #333', borderRadius: '4px', padding: '4px 8px', color: '#e0e0e0', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none' }} />
                  <button onClick={() => handleAddRule('local-deny')} style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setCcAddTarget(null)} style={{ background: '#333', color: '#999', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setCcNewRule(''); setCcAddTarget('local-deny') }} style={{
                  background: '#ffffff08', border: '1px solid #333', borderRadius: '4px', padding: '3px 8px',
                  color: '#888', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer', marginTop: '4px',
                }}>+ Add Rule</button>
              )}
            </div>
          </div>
        </>)}

        {/* About tab */}
        {tab === 'about' && (
          <div style={{ fontFamily: 'inherit', fontSize: '12px', color: '#ccc', lineHeight: '1.6' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 600 }}>CmdCLD</span>
              <span style={{ color: '#555', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace' }}>{appVersion ? `v${appVersion}` : ''}</span>
            </div>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: '16px' }}>Multi-terminal Claude launcher</div>

            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '16px', lineHeight: '1.7' }}>
              Created by Leon Nel at i60 Global, an enterprise<br />
              software company building platforms, AI tools,<br />
              and developer utilities for the insurance<br />
              industry since 2005.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ marginBottom: '4px' }}>
                <a
                  href="https://i60.co"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#22c55e', fontSize: '11px', textDecoration: 'none' }}
                >
                  → i60.co
                </a>
              </div>
              <div>
                <a
                  href="https://github.com/LeonNel123/i60.CmdCLD"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#22c55e', fontSize: '11px', textDecoration: 'none' }}
                >
                  → github.com/LeonNel123/i60.CmdCLD
                </a>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #333', margin: '12px 0' }} />

            <div style={{ color: '#555', fontSize: '11px', marginBottom: '12px' }}>
              © 2026 i60 · Licensed under MIT
            </div>

            <div style={{ borderTop: '1px solid #333', margin: '12px 0' }} />

            <div style={{ color: '#888', fontSize: '11px', marginBottom: '8px' }}>Build info</div>
            {[
              ['Electron', buildInfo?.electron],
              ['Chromium', buildInfo?.chrome],
              ['Node',     buildInfo?.node],
              ['Platform', buildInfo ? `${buildInfo.platform} ${buildInfo.release}` : undefined],
            ].map(([label, value]) => (
              <div key={label as string} style={{ display: 'flex', gap: '12px', marginBottom: '3px' }}>
                <span style={{ color: '#555', fontSize: '11px', width: '70px', flexShrink: 0 }}>{label}</span>
                <span style={{ color: '#aaa', fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace' }}>{value ?? '—'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
          {tab === 'settings' && (
            <>
              <button
                onClick={onClose}
                style={{
                  background: '#333', color: '#ccc', border: 'none',
                  borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
                  fontSize: '12px', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                style={{
                  background: '#22c55e', color: '#000', border: 'none',
                  borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
                  fontSize: '12px', fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                Save
              </button>
            </>
          )}
          {tab === 'claude config' && (
            <>
              <button
                onClick={onClose}
                style={{
                  background: '#333', color: '#ccc', border: 'none',
                  borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
                  fontSize: '12px', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveClaudeConfig}
                style={{
                  background: ccSaved ? '#166534' : '#22c55e', color: ccSaved ? '#ccc' : '#000', border: 'none',
                  borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
                  fontSize: '12px', fontFamily: 'inherit', fontWeight: 600,
                  transition: 'background 0.2s',
                }}
              >
                {ccSaved ? 'Saved' : 'Save'}
              </button>
            </>
          )}
          {tab === 'about' && (
            <button
              onClick={onClose}
              style={{
                background: '#333', color: '#ccc', border: 'none',
                borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
                fontSize: '12px', fontFamily: 'inherit',
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
