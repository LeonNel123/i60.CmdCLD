import { useState, useEffect, useCallback, useRef } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Sidebar } from './components/Sidebar'
import { IconRail } from './components/IconRail'
import { TerminalPanel, killPty } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { LaunchDialog } from './components/LaunchDialog'
import { MarkdownViewer } from './components/MarkdownViewer'
import { Toast } from './components/Toast'
import { WelcomeBackCard } from './components/WelcomeBackCard'
import { EmptyWorkspace } from './components/EmptyWorkspace'
import { ContextMenu } from './components/ContextMenu'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CommandPalette } from './components/CommandPalette'
import { AutopilotPanel } from './components/AutopilotPanel'
import { AutopilotKickoff } from './components/AutopilotKickoff'
import { FolderOpen, AppWindow, Star, FolderSearch, Code, Copy, Trash2, Sparkles } from './components/icons'
import { assignColor } from './utils/colors'
import { calculateLayout, getRowCount } from './utils/grid-layout'
import { onActivityChange } from './utils/terminal-activity'
import notificationSound from './assets/notification.wav'
import type { RecentFolder } from './types/api'
import {
  getArgsForAgent,
  normalizeAgentCli,
  stripResumeArgsForQuickLaunch,
  type AgentCli,
} from '../../shared/agent-cli'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
  agentCli?: AgentCli
  claudeArgs?: string
  codexArgs?: string
  isPlainShell?: boolean
}

type ViewMode = { type: 'grid' } | { type: 'focused'; terminalId: string }

export default function App() {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)
  const [showCloseAll, setShowCloseAll] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>({ type: 'grid' })
  const [defaultViewMode, setDefaultViewMode] = useState<'grid' | 'focused'>('grid')
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [pendingLaunch, setPendingLaunch] = useState<{ path: string; name: string; agentCli: AgentCli; args: string; argsByAgent: Record<AgentCli, string> } | null>(null)
  const [busyTerminals, setBusyTerminals] = useState<Set<string>>(new Set())
  const [defaultAgentCli, setDefaultAgentCli] = useState<AgentCli>('claude')
  const [claudeArgs, setClaudeArgs] = useState('--dangerously-skip-permissions')
  const [codexArgs, setCodexArgs] = useState('')
  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [notifyOnIdle, setNotifyOnIdle] = useState(false)
  const [projectsRoot, setProjectsRoot] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [markdownFile, setMarkdownFile] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'warn' } | null>(null)
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([])
  const [restoreSessionEnabled, setRestoreSessionEnabled] = useState(false)
  const [savedSessionProjects, setSavedSessionProjects] = useState<Array<{ path: string; agentCli?: AgentCli; claudeArgs: string; codexArgs?: string; isPlainShell: boolean }>>([])
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [autopilotKickoffFor, setAutopilotKickoffFor] = useState<string | null>(null)  // terminalId
  const [autopilotRunning, setAutopilotRunning] = useState<Set<string>>(new Set())
  const [autopilotPanelFor, setAutopilotPanelFor] = useState<string | null>(null)
  const [autopilotDefaults, setAutopilotDefaults] = useState({ costCap: 1.0, maxIterations: 40 })

  // Track terminal busy/idle state + notification sound
  const notifyRef = useRef(false)
  useEffect(() => { notifyRef.current = notifyOnIdle }, [notifyOnIdle])

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((message: string, kind: 'info' | 'warn' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, kind })
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => {
    const audio = new Audio(notificationSound)
    audio.volume = 0.3
    return onActivityChange((id, busy) => {
      setBusyTerminals((prev) => {
        const next = new Set(prev)
        if (busy) next.add(id)
        else next.delete(id)
        return next
      })
      // Play notification when terminal goes idle (was busy, now idle)
      if (!busy && notifyRef.current) {
        audio.currentTime = 0
        audio.play().catch(() => {})
      }
    })
  }, [])

  // Load settings + saved state + recent folders on mount
  useEffect(() => {
    Promise.all([
      window.api.settingsGetAll().catch(() => null),
      window.api.recentList().catch(() => [] as RecentFolder[]),
    ]).then(([settings, recent]) => {
      if (settings) {
        setDefaultAgentCli(normalizeAgentCli(settings.defaultAgentCli))
        setClaudeArgs(settings.claudeArgs)
        setCodexArgs(settings.codexArgs ?? '')
        setAskBeforeLaunch(settings.askBeforeLaunch)
        setNotifyOnIdle(settings.notifyOnIdle)
        setProjectsRoot(settings.projectsRoot)
        setDefaultViewMode(settings.defaultViewMode)
        setFavoriteFolders(settings.favoriteFolders ?? [])
        setRestoreSessionEnabled(settings.restoreSessionEnabled ?? false)
        setAutopilotDefaults({
          costCap: settings.autopilotDefaultCostCap ?? 1.0,
          maxIterations: settings.autopilotDefaultMaxIterations ?? 40,
        })
      }
      setRecentFolders(recent)
      setLoaded(true)
    })
  }, [])

  // Load saved session once at mount. Validates each path against the recent
  // db so we don't try to reopen folders that no longer exist or are on
  // unmounted drives. Empty result hides the welcome card.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const saved = await window.api.sessionLoadLast()
        if (cancelled || !saved) return
        const checks = await Promise.all(saved.projects.map(async (p) => {
          try {
            const status = await window.api.recentCheckPath(p.path)
            return status === 'ok' ? p : null
          } catch {
            return null
          }
        }))
        if (cancelled) return
        const valid = checks.filter((p): p is typeof saved.projects[number] => p !== null)
        setSavedSessionProjects(valid)
      } catch {
        // best-effort
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Debounced autosave of the open project set when restore is enabled.
  useEffect(() => {
    if (!restoreSessionEnabled) return
    const timer = setTimeout(() => {
      const projects = terminals.map((t) => ({
        path: t.path,
        agentCli: t.agentCli ?? 'claude',
        claudeArgs: t.claudeArgs ?? '',
        codexArgs: t.codexArgs ?? '',
        isPlainShell: t.isPlainShell ?? false,
      }))
      window.api.sessionSaveLast({ savedAt: Date.now(), projects }).catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [terminals, restoreSessionEnabled])

  // Flush save on window close so the most recent terminals state is captured
  // even if the 1s autosave debounce hasn't fired yet.
  useEffect(() => {
    if (!restoreSessionEnabled) return
    const onBeforeUnload = () => {
      const projects = terminals.map((t) => ({
        path: t.path,
        agentCli: t.agentCli ?? 'claude',
        claudeArgs: t.claudeArgs ?? '',
        codexArgs: t.codexArgs ?? '',
        isPlainShell: t.isPlainShell ?? false,
      }))
      void window.api.sessionSaveLast({ savedAt: Date.now(), projects })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [terminals, restoreSessionEnabled])

  // Listen for sessions created remotely
  useEffect(() => {
    const unsub = window.api.onRemoteSessionCreated((session) => {
      setTerminals((prev) => {
        if (prev.find((t) => t.id === session.id)) return prev
        const usedColors = prev.map((t) => t.color)
        const newEntry: TerminalEntry = {
          id: session.id,
          path: session.path,
          name: session.name,
          color: session.color || assignColor(usedColors),
          agentCli: normalizeAgentCli(session.agentCli),
          claudeArgs: session.claudeArgs,
          codexArgs: session.codexArgs ?? '',
        }
        const next = [...prev, newEntry]
        if (prev.length === 0 && defaultViewMode === 'focused') {
          setViewMode({ type: 'focused', terminalId: session.id })
        }
        setLayouts(calculateLayout(next.length).map((pos, i) => ({
          ...pos,
          i: next[i].id,
        })))
        return next
      })
    })
    return unsub
  }, [defaultViewMode])

  // Actually create a terminal with a specific agent CLI + args.
  const createTerminal = useCallback((folderPath: string, args: string, agentCli: AgentCli = defaultAgentCli) => {
    const normalizedAgent = normalizeAgentCli(agentCli)
    const usedColors = terminals.map((t) => t.color)
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: folderPath,
      name: folderPath.split(/[\\/]/).pop() || folderPath,
      color: assignColor(usedColors),
      agentCli: normalizedAgent,
      claudeArgs: normalizedAgent === 'claude' ? args : '',
      codexArgs: normalizedAgent === 'codex' ? args : '',
    }

    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)
    if (terminals.length === 0 && defaultViewMode === 'focused') {
      setViewMode({ type: 'focused', terminalId: newEntry.id })
    }

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)

    window.api.recentAdd(folderPath).then(() => {
      return window.api.recentList()
    }).then((list) => {
      setRecentFolders(list)
    }).catch(() => {})
  }, [defaultAgentCli, defaultViewMode, terminals])

  // Start the folder-open flow (may show dialog or launch directly)
  const startAddFolder = useCallback((folderPath: string) => {
    const name = folderPath.split(/[\\/]/).pop() || folderPath
    const agentCli = defaultAgentCli
    const argsByAgent = { claude: claudeArgs, codex: codexArgs }
    const args = getArgsForAgent(agentCli, { claudeArgs, codexArgs })
    if (askBeforeLaunch) {
      setPendingLaunch({ path: folderPath, name, agentCli, args, argsByAgent })
    } else {
      createTerminal(folderPath, args, agentCli)
    }
  }, [askBeforeLaunch, claudeArgs, codexArgs, createTerminal, defaultAgentCli])

  // Spawn a plain shell for the same folder path as an existing terminal
  const handleSpawnShell = useCallback((folderPath: string, parentColor: string) => {
    const folderName = folderPath.split(/[\\/]/).pop() || folderPath
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: folderPath,
      name: `${folderName} (shell)`,
      color: parentColor,
      isPlainShell: true,
    }

    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)
    if (terminals.length === 0 && defaultViewMode === 'focused') {
      setViewMode({ type: 'focused', terminalId: newEntry.id })
    }

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
  }, [defaultViewMode, terminals])

  const handleCloseAll = useCallback(() => {
    setShowCloseAll(true)
  }, [])

  const handleConfirmCloseAll = useCallback(() => {
    for (const t of terminals) {
      killPty(t.id)
    }
    setTerminals([])
    setLayouts([])
    setViewMode({ type: 'grid' })
    setShowCloseAll(false)
  }, [terminals])

  const handleAddFolder = useCallback(async () => {
    const folderPath = await window.api.selectFolder()
    if (!folderPath) return
    startAddFolder(folderPath)
  }, [startAddFolder])

  const handleQuickAgent = useCallback(async () => {
    const homeDir = await window.api.getHomeDir()
    const agentCli = defaultAgentCli
    const argsByAgent = {
      claude: stripResumeArgsForQuickLaunch('claude', claudeArgs),
      codex: stripResumeArgsForQuickLaunch('codex', codexArgs),
    }
    const quickArgs = getArgsForAgent(agentCli, {
      claudeArgs: argsByAgent.claude,
      codexArgs: argsByAgent.codex,
    })
    const name = homeDir.split(/[\\/]/).pop() || homeDir
    if (askBeforeLaunch) {
      setPendingLaunch({ path: homeDir, name, agentCli, args: quickArgs, argsByAgent })
    } else {
      createTerminal(homeDir, quickArgs, agentCli)
    }
  }, [askBeforeLaunch, claudeArgs, codexArgs, createTerminal, defaultAgentCli])

  // Open a plain shell in the user's home folder — no Claude.
  const handleQuickShell = useCallback(async () => {
    const homeDir = await window.api.getHomeDir()
    const folderName = homeDir.split(/[\\/]/).pop() || homeDir
    const usedColors = terminals.map((t) => t.color)
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: homeDir,
      name: `${folderName} (shell)`,
      color: assignColor(usedColors),
      isPlainShell: true,
    }
    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)
    if (terminals.length === 0 && defaultViewMode === 'focused') {
      setViewMode({ type: 'focused', terminalId: newEntry.id })
    }
    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
    window.api.recentAdd(homeDir).then(() => {
      return window.api.recentList()
    }).then((list) => {
      setRecentFolders(list)
    }).catch(() => {})
  }, [defaultViewMode, terminals])

  const handleToggleFavorite = useCallback((path: string) => {
    setFavoriteFolders((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
      window.api.settingsSet('favoriteFolders', next)
      return next
    })
  }, [])

  const handleRemoveRecent = useCallback(async (path: string) => {
    try {
      const current = await window.api.recentList()
      setRecentFolders(current.filter((r) => r.path !== path))
    } catch {
      // best-effort
    }
  }, [])

  const handleReopenSavedSession = useCallback(() => {
    if (savedSessionProjects.length === 0) {
      setWelcomeDismissed(true)
      return
    }
    // Single batched setTerminals so all saved projects survive — calling
    // createTerminal in a loop would use a stale `terminals` closure and
    // each iteration would overwrite the last. Build all entries up front
    // against the live `prev` and apply once.
    setTerminals((prev) => {
      const usedColors = [...prev.map((t) => t.color)]
      const newEntries: TerminalEntry[] = savedSessionProjects.map((p) => {
        const folderName = p.path.split(/[\\/]/).pop() || p.path
        const color = assignColor(usedColors)
        usedColors.push(color)
        const agentCli = normalizeAgentCli(p.agentCli)
        return p.isPlainShell
          ? { id: crypto.randomUUID(), path: p.path, name: `${folderName} (shell)`, color, isPlainShell: true }
          : {
              id: crypto.randomUUID(),
              path: p.path,
              name: folderName,
              color,
              agentCli,
              claudeArgs: p.claudeArgs,
              codexArgs: p.codexArgs ?? '',
            }
      })
      const next = [...prev, ...newEntries]
      if (prev.length === 0 && defaultViewMode === 'focused' && newEntries.length > 0) {
        setViewMode({ type: 'focused', terminalId: newEntries[0].id })
      }
      setLayouts(calculateLayout(next.length).map((pos, i) => ({ ...pos, i: next[i].id })))
      return next
    })
    for (const p of savedSessionProjects) {
      window.api.recentAdd(p.path).catch(() => {})
    }
    setWelcomeDismissed(true)
  }, [savedSessionProjects, defaultViewMode])

  const handleOpenRecent = useCallback(async (folderPath: string) => {
    let status: 'ok' | 'missing' | 'unmounted' = 'ok'
    try {
      status = await window.api.recentCheckPath(folderPath)
    } catch {
      // fail-open: let the OS surface any error
    }
    const name = folderPath.split(/[\\/]/).pop() || folderPath
    if (status === 'ok') {
      startAddFolder(folderPath)
    } else if (status === 'missing') {
      showToast(`"${name}" no longer exists — removed from recents`, 'warn')
      window.api.recentList().then(setRecentFolders).catch(() => {})
    } else /* 'unmounted' */ {
      showToast(`"${name}" is on a drive that isn't currently mounted`, 'info')
    }
  }, [startAddFolder, showToast])

  const handleLaunchConfirm = useCallback((args: string, agentCli: AgentCli) => {
    if (!pendingLaunch) return
    createTerminal(pendingLaunch.path, args, agentCli)
    setPendingLaunch(null)
  }, [pendingLaunch, createTerminal])

  const handleRequestClose = useCallback((id: string) => {
    setClosingId(id)
  }, [])

  const handleConfirmClose = useCallback(() => {
    if (!closingId) return
    killPty(closingId)
    const newTerminals = terminals.filter((t) => t.id !== closingId)
    setTerminals(newTerminals)

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
    setClosingId(null)
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === closingId
        ? { type: 'grid' }
        : prev
    )
  }, [closingId, terminals])

  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setLayouts(layout)
  }, [])

  const handleNewWindow = useCallback(() => {
    window.api.windowCreate()
  }, [])

  const handleSelectTerminal = useCallback((id: string) => {
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === id
        ? { type: 'grid' }
        : { type: 'focused', terminalId: id }
    )
  }, [])

  const handleShowAll = useCallback(() => {
    setViewMode({ type: 'grid' })
  }, [])

  const handleSettingsClosed = useCallback(() => {
    setShowSettings(false)
    window.api.settingsGetAll().then((s) => {
      setDefaultAgentCli(normalizeAgentCli(s.defaultAgentCli))
      setClaudeArgs(s.claudeArgs)
      setCodexArgs(s.codexArgs ?? '')
      setAskBeforeLaunch(s.askBeforeLaunch)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      setDefaultViewMode(s.defaultViewMode)
    }).catch(() => {})
  }, [])

  const handleNewProject = useCallback(async () => {
    if (!newProjectName.trim()) return
    const path = await window.api.projectCreate(newProjectName.trim())
    if (path) {
      setShowNewProject(false)
      setNewProjectName('')
      startAddFolder(path)
    }
  }, [newProjectName, startAddFolder])

  // Cmd+P / Ctrl+P opens the fuzzy command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = window.api.platform === 'darwin'
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const off = window.api.onAutopilotUpdate((terminalId, state: any) => {
      setAutopilotRunning((prev) => {
        const isClassicRunning = state && ['wizard', 'awaiting_goal_review', 'executing', 'paused'].includes(state.phase)
        const isProRunning = state && state.stage && state.stage !== 'done' && state.control !== 'stopped'
        const isRunning = isClassicRunning || isProRunning
        const next = new Set(prev)
        if (isRunning) next.add(terminalId); else next.delete(terminalId)
        return next
      })
    })
    return () => { off() }
  }, [])

  // Global keyboard shortcuts (Cmd on macOS, Ctrl on Windows/Linux)
  useEffect(() => {
    const isMac = window.api.platform === 'darwin'
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      // Mod+1-9: switch to terminal by index
      if (mod && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        if (idx < terminals.length) {
          setViewMode({ type: 'focused', terminalId: terminals[idx].id })
          e.preventDefault()
        }
        return
      }
      // Mod+T: add folder
      if (mod && e.key === 't') {
        e.preventDefault()
        handleAddFolder()
        return
      }
      // Mod+`: show all (grid view)
      if (mod && e.key === '`') {
        e.preventDefault()
        setViewMode({ type: 'grid' })
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [terminals, handleAddFolder])

  const gridRows = getRowCount(terminals.length)
  const rowHeight = Math.max(150, Math.floor(window.innerHeight / gridRows) - 4)
  const isFocused = viewMode.type === 'focused'

  if (!loaded) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e1e',
        color: '#666',
        fontSize: '14px',
        fontFamily: 'monospace',
      }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#1e1e1e' }}>
      <IconRail
        onAddFolder={handleAddFolder}
        onQuickAgent={handleQuickAgent}
        onQuickShell={handleQuickShell}
        onNewWindow={handleNewWindow}
        onNewProject={() => setShowNewProject(true)}
        onOpenSettings={() => setShowSettings(true)}
        hasProjectsRoot={Boolean(projectsRoot)}
      />
      <Sidebar
        terminals={terminals}
        viewMode={viewMode}
        busyTerminals={busyTerminals}
        onSelectTerminal={handleSelectTerminal}
        onShowAll={handleShowAll}
        recentFolders={recentFolders}
        onOpenRecent={handleOpenRecent}
        onCloseAll={handleCloseAll}
        favoriteFolders={favoriteFolders}
        onToggleFavorite={handleToggleFavorite}
        onContextMenu={(path, x, y) => setContextMenu({ path, x, y })}
      />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <ErrorBoundary>
        {terminals.length === 0 && savedSessionProjects.length > 0 && !welcomeDismissed && (
          <WelcomeBackCard
            count={savedSessionProjects.length}
            onReopen={handleReopenSavedSession}
            onDismiss={() => setWelcomeDismissed(true)}
          />
        )}
        {terminals.length === 0 && (savedSessionProjects.length === 0 || welcomeDismissed) && (
          <EmptyWorkspace />
        )}

        {/* Grid mode */}
        {terminals.length > 0 && !isFocused && (
          <ResponsiveGridLayout
            layouts={{ lg: layouts }}
            breakpoints={{ lg: 0 }}
            cols={{ lg: 12 }}
            rowHeight={rowHeight}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            compactType="vertical"
            margin={[2, 2]}
          >
            {terminals.map((t) => (
              <div key={t.id}>
                <TerminalPanel
                  id={t.id}
                  folderPath={t.path}
                  folderName={t.name}
                  color={t.color}
                  agentCli={t.agentCli}
                  claudeArgs={t.claudeArgs}
                  codexArgs={t.codexArgs}
                  isPlainShell={t.isPlainShell}
                  onClose={() => handleRequestClose(t.id)}
                  onSpawnShell={() => handleSpawnShell(t.path, t.color)}
                  onOpenMarkdown={setMarkdownFile}
                  onStartAutopilot={() => setAutopilotKickoffFor(t.id)}
                  isAutopilotRunning={autopilotRunning.has(t.id)}
                  onShowAutopilotPanel={() => setAutopilotPanelFor(t.id)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}

        {/* Focused mode — all terminals rendered, only focused one visible */}
        {isFocused && terminals.map((t) => (
          <div
            key={t.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: viewMode.terminalId === t.id ? 'block' : 'none',
            }}
          >
            <TerminalPanel
              id={t.id}
              folderPath={t.path}
              folderName={t.name}
              color={t.color}
              agentCli={t.agentCli}
              claudeArgs={t.claudeArgs}
              codexArgs={t.codexArgs}
              isPlainShell={t.isPlainShell}
              onClose={() => handleRequestClose(t.id)}
              onSpawnShell={() => handleSpawnShell(t.path, t.color)}
              onOpenMarkdown={setMarkdownFile}
              onStartAutopilot={() => setAutopilotKickoffFor(t.id)}
              isAutopilotRunning={autopilotRunning.has(t.id)}
              onShowAutopilotPanel={() => setAutopilotPanelFor(t.id)}
            />
          </div>
        ))}
        </ErrorBoundary>
      </div>

      {autopilotPanelFor && (
        <AutopilotPanel
          terminalId={autopilotPanelFor}
          onClose={() => setAutopilotPanelFor(null)}
        />
      )}

      {closingId && (
        <ConfirmDialog
          message={`Close terminal for "${terminals.find((t) => t.id === closingId)?.name}"?`}
          onConfirm={handleConfirmClose}
          onCancel={() => setClosingId(null)}
        />
      )}

      {showCloseAll && (
        <ConfirmDialog
          message={`Close all ${terminals.length} terminal${terminals.length !== 1 ? 's' : ''}?`}
          onConfirm={handleConfirmCloseAll}
          onCancel={() => setShowCloseAll(false)}
        />
      )}

      {showSettings && (
        <SettingsDialog
          onClose={handleSettingsClosed}
          activeProjectPath={
            (viewMode.type === 'focused'
              ? terminals.find((t) => t.id === viewMode.terminalId)?.path
              : terminals[0]?.path) ?? undefined
          }
        />
      )}

      {pendingLaunch && (
        <LaunchDialog
          folderName={pendingLaunch.name}
          defaultAgentCli={pendingLaunch.agentCli}
          defaultArgs={pendingLaunch.args}
          defaultArgsByAgent={pendingLaunch.argsByAgent}
          onLaunch={handleLaunchConfirm}
          onCancel={() => setPendingLaunch(null)}
        />
      )}

      {markdownFile && (
        <MarkdownViewer
          filePath={markdownFile}
          onClose={() => setMarkdownFile(null)}
        />
      )}

      {toast && (
        <Toast message={toast.message} kind={toast.kind} />
      )}

      {contextMenu && (() => {
        const path = contextMenu.path
        const isFav = favoriteFolders.includes(path)
        const isOpen = terminals.some((t) => t.path === path)
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              { label: 'Open', icon: FolderOpen, onClick: () => handleOpenRecent(path), disabled: isOpen },
              { label: 'Open in new window', icon: AppWindow, onClick: () => { window.api.windowCreate().catch(() => {}) } },
              { label: 'Start with Autopilot', icon: Sparkles, onClick: () => {
                // Open the project (this creates a terminal), then trigger kickoff for that terminal.
                handleOpenRecent(path)
                // Defer until terminal is created; pick up via the most recent terminal of this path.
                setTimeout(() => {
                  const t = terminals.find((tt) => tt.path === path)
                  if (t) setAutopilotKickoffFor(t.id)
                }, 200)
              }},
              { label: isFav ? 'Remove from favorites' : 'Add to favorites', icon: Star, onClick: () => handleToggleFavorite(path) },
              { label: 'Open in Explorer', icon: FolderSearch, onClick: () => { window.api.openInExplorer(path).catch(() => {}) } },
              { label: 'Open in Editor', icon: Code, onClick: () => { window.api.openInEditor(path).catch(() => {}) } },
              { label: 'Copy path', icon: Copy, onClick: () => { navigator.clipboard.writeText(path).catch(() => {}) } },
              { label: '', divider: true, onClick: () => {} },
              { label: 'Remove from recents', icon: Trash2, onClick: () => handleRemoveRecent(path), destructive: true },
            ]}
          />
        )
      })()}

      {paletteOpen && (
        <CommandPalette
          recentFolders={recentFolders}
          favoriteFolders={favoriteFolders}
          onOpen={handleOpenRecent}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {autopilotKickoffFor && (() => {
        const t = terminals.find((tt) => tt.id === autopilotKickoffFor)
        if (!t) return null
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
               onClick={() => setAutopilotKickoffFor(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: '90%' }}>
              <AutopilotKickoff
                terminalId={t.id}
                projectPath={t.path}
                agentCli={normalizeAgentCli(t.agentCli)}
                launchArgs={normalizeAgentCli(t.agentCli) === 'codex' ? t.codexArgs ?? '' : t.claudeArgs ?? ''}
                defaultCostCap={autopilotDefaults.costCap}
                defaultMaxIterations={autopilotDefaults.maxIterations}
                onStarted={() => {
                  setAutopilotKickoffFor(null)
                  setAutopilotPanelFor(t.id)
                }}
                onCancel={() => setAutopilotKickoffFor(null)}
              />
            </div>
          </div>
        )
      })()}

      {showNewProject && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000,
        }} onClick={() => setShowNewProject(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#1a1a2e', borderRadius: '8px', padding: '20px',
            maxWidth: '420px', width: '90%', border: '1px solid #333',
          }}>
            <h3 style={{ color: '#e0e0e0', margin: '0 0 12px', fontSize: '14px', fontFamily: 'monospace' }}>
              New Project
            </h3>
            <div style={{ color: '#666', fontSize: '10px', fontFamily: 'monospace', marginBottom: '8px' }}>
              Creates folder in: {projectsRoot}
            </div>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNewProject() }}
              autoFocus
              placeholder="project-name"
              style={{
                width: '100%', background: '#0d1117', border: '1px solid #333',
                borderRadius: '4px', padding: '8px 10px', color: '#e0e0e0',
                fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace', outline: 'none',
                boxSizing: 'border-box', marginBottom: '12px',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewProject(false)} style={{
                background: '#333', color: '#ccc', border: 'none', borderRadius: '4px',
                padding: '6px 14px', cursor: 'pointer', fontSize: '12px', fontFamily: 'monospace',
              }}>Cancel</button>
              <button onClick={handleNewProject} style={{
                background: '#22c55e', color: '#000', border: 'none', borderRadius: '4px',
                padding: '6px 14px', cursor: 'pointer', fontSize: '12px', fontFamily: 'monospace', fontWeight: 600,
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
