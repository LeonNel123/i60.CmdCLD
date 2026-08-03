import { useEffect, useState } from 'react'
import { X } from '../icons'
import { normalizeAgentCli, type AgentCli } from '../../../../shared/agent-cli'
import { clampTerminalFontSize, resolveTerminalFontFamily, DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE } from '../../../../shared/terminal-font'
import { resolveAppFontFamily, DEFAULT_APP_FONT_FAMILY } from '../../../../shared/app-font'
import { clampUiScalePct, DEFAULT_UI_SCALE_PCT } from '../../../../shared/ui-scale'
import type { BuildInfo, TailscaleStatus } from './types'
import { GeneralPane } from './GeneralPane'
import { AgentsPane } from './AgentsPane'
import { AppearancePane } from './AppearancePane'
import { RemotePane } from './RemotePane'
import { ClaudeConfigPane } from './ClaudeConfigPane'
import { AutopilotPane } from './AutopilotPane'
import { AboutPane } from './AboutPane'
import { MONO_FONT } from './controls'

interface SettingsDialogProps {
  onClose: () => void
  activeProjectPath?: string
}

type Category = 'general' | 'agents' | 'appearance' | 'remote' | 'claude' | 'autopilot' | 'about'

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'remote', label: 'Remote Access' },
  { id: 'claude', label: 'Claude Config' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'about', label: 'About' },
]

export function SettingsDialog({ onClose, activeProjectPath }: SettingsDialogProps) {
  const [category, setCategory] = useState<Category>('general')

  // App settings (persisted by save())
  const [defaultAgentCli, setDefaultAgentCli] = useState<AgentCli>('claude')
  const [agentArgsTab, setAgentArgsTab] = useState<AgentCli>('claude')
  const [claudeArgs, setClaudeArgs] = useState('')
  const [codexArgs, setCodexArgs] = useState('')
  const [cliAvailability, setCliAvailability] = useState<Record<AgentCli, { available: boolean; path: string | null }> | null>(null)
  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [defaultViewMode, setDefaultViewMode] = useState<'grid' | 'focused'>('grid')
  const [notifyOnIdle, setNotifyOnIdle] = useState(false)
  const [restoreSessionEnabled, setRestoreSessionEnabled] = useState(false)
  const [restoreSessionResume, setRestoreSessionResume] = useState(false)
  const [terminalFontFamily, setTerminalFontFamily] = useState<string>(DEFAULT_TERMINAL_FONT_FAMILY)
  const [terminalFontSize, setTerminalFontSize] = useState<number>(DEFAULT_TERMINAL_FONT_SIZE)
  const [appFontFamily, setAppFontFamily] = useState<string>(DEFAULT_APP_FONT_FAMILY)
  const [uiScalePct, setUiScalePct] = useState<number>(DEFAULT_UI_SCALE_PCT)
  const [projectsRoot, setProjectsRoot] = useState('')
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  // Autopilot settings (persisted by save())
  const [apProvider, setApProvider] = useState<'anthropic' | 'openrouter'>('anthropic')
  const [apModel, setApModel] = useState('claude-sonnet-5')
  const [apCostCap, setApCostCap] = useState(1.0)
  const [apMaxIter, setApMaxIter] = useState(40)

  // Remote access (applies immediately)
  const [remoteAccess, setRemoteAccess] = useState(false)
  const [remotePort, setRemotePort] = useState(3456)
  const [remoteUrls, setRemoteUrls] = useState<string[]>([])
  const [remoteError, setRemoteError] = useState('')
  const [tsStatus, setTsStatus] = useState<TailscaleStatus | null>(null)
  const [tsBusy, setTsBusy] = useState(false)
  const [tsError, setTsError] = useState('')

  // About
  const [appVersion, setAppVersion] = useState('')
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)

  // Claude CLI config (persisted by saveClaudeConfig())
  const [ccDisableBypass, setCcDisableBypass] = useState(false)
  const [ccDefaultMode, setCcDefaultMode] = useState('default')
  const [ccEffort, setCcEffort] = useState('')
  const [ccModel, setCcModel] = useState('')
  const [ccAutoUpdates, setCcAutoUpdates] = useState('')
  const [ccGlobalAllow, setCcGlobalAllow] = useState<string[]>([])
  const [ccGlobalDeny, setCcGlobalDeny] = useState<string[]>([])
  const [ccLocalAllow, setCcLocalAllow] = useState<string[]>([])
  const [ccLocalDeny, setCcLocalDeny] = useState<string[]>([])
  const [ccLoaded, setCcLoaded] = useState(false)
  const [ccSaved, setCcSaved] = useState(false)

  useEffect(() => {
    window.api.getVersion().then(setAppVersion).catch(() => {})
    window.api.getBuildInfo().then(setBuildInfo).catch(() => {})
    window.api.settingsGetAll().then((s) => {
      const loadedAgent = normalizeAgentCli(s.defaultAgentCli)
      setDefaultAgentCli(loadedAgent)
      setAgentArgsTab(loadedAgent)
      setClaudeArgs(s.claudeArgs)
      setCodexArgs(s.codexArgs ?? '')
      setAskBeforeLaunch(s.askBeforeLaunch)
      setDefaultViewMode(s.defaultViewMode)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      setRemoteAccess(s.remoteAccess ?? false)
      setRemotePort(s.remotePort ?? 3456)
      setFavoriteFolders(s.favoriteFolders ?? [])
      setRestoreSessionEnabled(s.restoreSessionEnabled ?? false)
      setRestoreSessionResume(s.restoreSessionResume ?? false)
      setTerminalFontFamily(resolveTerminalFontFamily(s.terminalFontFamily))
      setTerminalFontSize(clampTerminalFontSize(s.terminalFontSize))
      setAppFontFamily(resolveAppFontFamily(s.appFontFamily))
      setUiScalePct(clampUiScalePct(s.uiScalePct))
      setApProvider((s.autopilotApiProvider as 'anthropic' | 'openrouter') ?? 'anthropic')
      setApModel(s.autopilotPlannerModel ?? 'claude-sonnet-5')
      setApCostCap(s.autopilotDefaultCostCap ?? 1.0)
      setApMaxIter(s.autopilotDefaultMaxIterations ?? 40)
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
    window.api.agentCliAvailability().then(setCliAvailability).catch(() => {})
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

  const save = () => {
    window.api.settingsSet('defaultAgentCli', defaultAgentCli)
    window.api.settingsSet('claudeArgs', claudeArgs)
    window.api.settingsSet('codexArgs', codexArgs)
    window.api.settingsSet('askBeforeLaunch', askBeforeLaunch)
    window.api.settingsSet('defaultViewMode', defaultViewMode)
    window.api.settingsSet('notifyOnIdle', notifyOnIdle)
    window.api.settingsSet('projectsRoot', projectsRoot)
    window.api.settingsSet('remotePort', remotePort)
    window.api.settingsSet('favoriteFolders', favoriteFolders)
    window.api.settingsSet('restoreSessionEnabled', restoreSessionEnabled)
    window.api.settingsSet('restoreSessionResume', restoreSessionResume)
    if (!restoreSessionEnabled) {
      // Clear the saved file so the next launch behaves like a fresh install.
      window.api.sessionClearLast().catch(() => {})
    }
    window.api.settingsSet('terminalFontFamily', resolveTerminalFontFamily(terminalFontFamily))
    window.api.settingsSet('terminalFontSize', clampTerminalFontSize(terminalFontSize))
    window.api.settingsSet('appFontFamily', resolveAppFontFamily(appFontFamily))
    window.api.settingsSet('uiScalePct', clampUiScalePct(uiScalePct))
    window.api.settingsSet('autopilotApiProvider', apProvider)
    window.api.settingsSet('autopilotPlannerModel', apModel)
    window.api.settingsSet('autopilotDefaultCostCap', apCostCap)
    window.api.settingsSet('autopilotDefaultMaxIterations', apMaxIter)
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

  if (!loaded) return null

  const pane = (() => {
    switch (category) {
      case 'general':
        return (
          <GeneralPane
            defaultViewMode={defaultViewMode} onDefaultViewModeChange={setDefaultViewMode}
            askBeforeLaunch={askBeforeLaunch} onAskBeforeLaunchChange={setAskBeforeLaunch}
            notifyOnIdle={notifyOnIdle} onNotifyOnIdleChange={setNotifyOnIdle}
            restoreSessionEnabled={restoreSessionEnabled} onRestoreSessionEnabledChange={setRestoreSessionEnabled}
            restoreSessionResume={restoreSessionResume} onRestoreSessionResumeChange={setRestoreSessionResume}
            projectsRoot={projectsRoot} onProjectsRootChange={setProjectsRoot}
          />
        )
      case 'agents':
        return (
          <AgentsPane
            defaultAgentCli={defaultAgentCli} onDefaultAgentCliChange={setDefaultAgentCli}
            agentArgsTab={agentArgsTab} onAgentArgsTabChange={setAgentArgsTab}
            claudeArgs={claudeArgs} onClaudeArgsChange={setClaudeArgs}
            codexArgs={codexArgs} onCodexArgsChange={setCodexArgs}
            cliAvailability={cliAvailability}
          />
        )
      case 'appearance':
        return (
          <AppearancePane
            terminalFontFamily={terminalFontFamily} onTerminalFontFamilyChange={setTerminalFontFamily}
            terminalFontSize={terminalFontSize} onTerminalFontSizeChange={setTerminalFontSize}
            appFontFamily={appFontFamily} onAppFontFamilyChange={setAppFontFamily}
            uiScalePct={uiScalePct} onUiScalePctChange={setUiScalePct}
          />
        )
      case 'remote':
        return (
          <RemotePane
            remoteAccess={remoteAccess} onRemoteToggle={(v) => { void handleRemoteToggle(v) }}
            remotePort={remotePort} onRemotePortChange={setRemotePort}
            remoteUrls={remoteUrls} remoteError={remoteError}
            tsStatus={tsStatus} tsBusy={tsBusy} tsError={tsError}
            onTailscaleServeToggle={(v) => { void handleTailscaleServeToggle(v) }}
            favoriteFolders={favoriteFolders} onFavoriteFoldersChange={setFavoriteFolders}
          />
        )
      case 'claude':
        return (
          <ClaudeConfigPane
            loaded={ccLoaded}
            disableBypass={ccDisableBypass} onDisableBypassChange={setCcDisableBypass}
            defaultMode={ccDefaultMode} onDefaultModeChange={setCcDefaultMode}
            effort={ccEffort} onEffortChange={setCcEffort}
            model={ccModel} onModelChange={setCcModel}
            autoUpdates={ccAutoUpdates} onAutoUpdatesChange={setCcAutoUpdates}
            globalAllow={ccGlobalAllow} onGlobalAllowChange={setCcGlobalAllow}
            globalDeny={ccGlobalDeny} onGlobalDenyChange={setCcGlobalDeny}
            localAllow={ccLocalAllow} onLocalAllowChange={setCcLocalAllow}
            localDeny={ccLocalDeny} onLocalDenyChange={setCcLocalDeny}
          />
        )
      case 'autopilot':
        return (
          <AutopilotPane
            provider={apProvider} onProviderChange={setApProvider}
            model={apModel} onModelChange={setApModel}
            costCap={apCostCap} onCostCapChange={setApCostCap}
            maxIter={apMaxIter} onMaxIterChange={setApMaxIter}
            activeProjectPath={activeProjectPath}
          />
        )
      case 'about':
        return <AboutPane appVersion={appVersion} buildInfo={buildInfo} />
    }
  })()

  const footerButton = (label: string, onClick: () => void, primary?: boolean, saved?: boolean) => (
    <button
      onClick={onClick}
      style={{
        background: primary ? (saved ? '#166534' : '#22c55e') : '#333',
        color: primary ? (saved ? '#ccc' : '#000') : '#ccc',
        border: 'none', borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
        fontSize: '12px', fontFamily: 'inherit', fontWeight: primary ? 600 : 400,
        transition: 'background 0.2s',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="ui-scaled"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000,
      }}
      onClick={onClose}
    >
      <style>{`
        .settings-nav-item:hover { background: rgba(255,255,255,0.05); }
        .settings-content::-webkit-scrollbar { width: 8px; }
        .settings-content::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a2e', borderRadius: '8px', border: '1px solid #333',
          // vw/vh scale with the .ui-scaled zoom; divide them back out so the
          // dialog fits the real viewport at any interface scale.
          width: 'min(calc(92vw / var(--ui-scale, 1)), 740px)',
          height: 'min(calc(85vh / var(--ui-scale, 1)), 640px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 16px 12px', borderBottom: '1px solid #2a2a3a', flexShrink: 0,
        }}>
          <span style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit' }}>Settings</span>
          {appVersion && (
            <span style={{ color: '#555', fontSize: '11px', fontFamily: MONO_FONT }}>v{appVersion}</span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            title="Close"
            style={{
              background: 'none', border: 'none', color: '#888', cursor: 'pointer',
              padding: '2px', display: 'flex', alignItems: 'center',
            }}
          >
            <X width={14} height={14} />
          </button>
        </div>

        {/* Body: nav rail + content */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <nav style={{
            width: '150px', flexShrink: 0, borderRight: '1px solid #2a2a3a',
            padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: '2px',
          }}>
            {CATEGORIES.map((c) => {
              const active = category === c.id
              return (
                <button
                  key={c.id}
                  className="settings-nav-item"
                  onClick={() => setCategory(c.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: active ? '#22c55e14' : 'none',
                    border: 'none', borderRadius: '6px',
                    padding: '7px 10px',
                    color: active ? '#22c55e' : '#aaa',
                    fontSize: '12px', fontFamily: 'inherit',
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'background 80ms ease',
                  }}
                >
                  {c.label}
                </button>
              )
            })}
          </nav>
          <div className="settings-content" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', minWidth: 0 }}>
            {pane}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: '8px', justifyContent: 'flex-end',
          padding: '12px 16px', borderTop: '1px solid #2a2a3a', flexShrink: 0,
        }}>
          {category === 'about' ? (
            footerButton('Close', onClose)
          ) : category === 'claude' ? (
            <>
              {footerButton('Cancel', onClose)}
              {footerButton(ccSaved ? 'Saved' : 'Save', saveClaudeConfig, true, ccSaved)}
            </>
          ) : (
            <>
              {footerButton('Cancel', onClose)}
              {footerButton('Save', save, true)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
