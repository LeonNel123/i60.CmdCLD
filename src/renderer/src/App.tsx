import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Sidebar } from './components/Sidebar'
import { TerminalPanel, killPty } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { LaunchDialog } from './components/LaunchDialog'
import { MarkdownViewer } from './components/MarkdownViewer'
import { BroadcastBar } from './components/BroadcastBar'
import { PromptHistory } from './components/PromptHistory'
import { Toast } from './components/Toast'
import { WelcomeBackCard } from './components/WelcomeBackCard'
import { EmptyWorkspace } from './components/EmptyWorkspace'
import { ContextMenu } from './components/ContextMenu'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CommandPalette } from './components/CommandPalette'
import { AutopilotPanel } from './components/AutopilotPanel'
import { AutopilotKickoff } from './components/AutopilotKickoff'
import { TaskBar } from './components/TaskBar'
import { AppWindow, Star, FolderSearch, Code, Copy, Trash2, Sparkles, TerminalSquare, Shield } from './components/icons'
import { assignColor } from './utils/colors'
import { calculateLayout, getRowCount } from './utils/grid-layout'
import { createHeightTracker } from './utils/element-height'
import { onActivityChange } from './utils/terminal-activity'
import notificationSound from './assets/notification.wav'
import type { RecentFolder } from './types/api'
import {
  getArgsForAgent,
  resolveProjectLaunch,
  normalizeAgentCli,
  stripResumeArgsForQuickLaunch,
  ensureResumeArgs,
  AGENT_CLIS,
  AGENT_CLI_LABELS,
  type AgentCli,
} from '../../shared/agent-cli'
import { resolveRestoredSession, minimizedIdsFromRestore } from '../../shared/session-restore'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  clampTerminalFontSize,
  resolveTerminalFontFamily,
} from '../../shared/terminal-font'
import { DEFAULT_APP_FONT_FAMILY, resolveAppFontFamily } from '../../shared/app-font'
import { DEFAULT_UI_SCALE_PCT, clampUiScalePct, chromeScale, uiScaleFactor } from '../../shared/ui-scale'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
  agentCli?: AgentCli
  claudeArgs?: string
  codexArgs?: string
  grokArgs?: string
  opencodeArgs?: string
  isPlainShell?: boolean
  // Admin shell via elevation bridge. Deliberately not persisted to the
  // last-session store — restoring it would fire a UAC prompt at startup.
  elevated?: boolean
}

type ViewMode = { type: 'grid' } | { type: 'focused'; terminalId: string }

// The grid lays out only the visible terminals — minimized ones live in the
// TaskBar and must not occupy (or count toward) grid cells.
function layoutsForVisible(list: TerminalEntry[], minimized: Set<string>): Layout[] {
  const visible = list.filter((t) => !minimized.has(t.id))
  return calculateLayout(visible.length).map((pos, i) => ({ ...pos, i: visible[i].id }))
}

export default function App() {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  // Window-style minimize: minimized terminals leave the grid (the rest
  // reflow) and live as chips in the bottom TaskBar. Their ptys stay alive in
  // the main process; the panel simply unmounts and replays scrollback on
  // restore — the same mechanics as switching grid <-> focused view.
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set())
  // Minimized terminals that went busy -> idle while tucked away (finished
  // something); their taskbar chip asks for attention until restored.
  const [attentionIds, setAttentionIds] = useState<Set<string>>(new Set())
  // Ref mirror so setTerminals updaters and the activity listener see the
  // current set without joining every dependency array.
  const minimizedRef = useRef(minimizedIds)
  minimizedRef.current = minimizedIds
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closeWarning, setCloseWarning] = useState<string | null>(null)
  const [showCloseAll, setShowCloseAll] = useState(false)
  const [closeAllWarning, setCloseAllWarning] = useState<string | null>(null)
  const [showCloseWindow, setShowCloseWindow] = useState(false)
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
  const [grokArgs, setGrokArgs] = useState('')
  const [opencodeArgs, setOpencodeArgs] = useState('')
  // Last CLI + args per folder. Without this, defaultAgentCli silently retargets every
  // project at once: change the default while inspecting a CLI and every favourite
  // opens with it, including projects that CLI has never run in.
  const [projectAgents, setProjectAgents] = useState<Record<string, { agentCli: AgentCli; args: string }>>({})
  // Functional update so this never reads a stale map from a closure; the write is
  // fire-and-forget because failing to remember a choice must not block the launch.
  const rememberProjectAgent = useCallback((folderPath: string, agentCli: AgentCli, args: string) => {
    setProjectAgents((prev) => {
      const existing = prev[folderPath]
      if (existing && existing.agentCli === agentCli && existing.args === args) return prev
      const next = { ...prev, [folderPath]: { agentCli, args } }
      window.api.settingsSet('projectAgents', next).catch(() => {})
      return next
    })
  }, [])

  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [notifyOnIdle, setNotifyOnIdle] = useState(false)
  const [projectsRoot, setProjectsRoot] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [markdownFile, setMarkdownFile] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'warn' } | null>(null)
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([])
  const [restoreSessionEnabled, setRestoreSessionEnabled] = useState(false)
  const [restoreSessionResume, setRestoreSessionResume] = useState(false)
  const [savedSessionProjects, setSavedSessionProjects] = useState<Array<{ path: string; agentCli?: AgentCli; claudeArgs: string; codexArgs?: string; grokArgs?: string; opencodeArgs?: string; isPlainShell: boolean; minimized?: boolean }>>([])
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [quickShellMenu, setQuickShellMenu] = useState<{ x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [autopilotKickoffFor, setAutopilotKickoffFor] = useState<string | null>(null)  // terminalId
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Broadcast console selection, kept here so closing and reopening the bar does not
  // reset it. Session-only: deliberately not persisted, since which consoles are open
  // rarely survives a restart anyway.
  const [broadcastSelection, setBroadcastSelection] = useState<{ selected: string[]; known: string[] } | null>(null)
  // Memoised deliberately. Building this inline gave BroadcastBar a new array identity
  // on every App render, which invalidated its targets memo, which re-fired the effect
  // that pushes the selection back up here — a render loop that pegged a core.
  // Actual height of the terminal area. A ResizeObserver keeps it current as the
  // broadcast bar opens, closes, or grows, so the grid always fits the space it has.
  // External terminals available on this machine, probed once. Empty means no entries
  // are offered rather than showing an item that cannot work.
  const [externalTerminals, setExternalTerminals] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    window.api.terminalListExternal().then(setExternalTerminals).catch(() => setExternalTerminals([]))
  }, [])


  const [gridAreaHeight, setGridAreaHeight] = useState(() => window.innerHeight)
  // Ref callback, not an effect: the grid area is absent from the tree on the first
  // render (the !loaded branch below returns a loading screen), so an effect with []
  // deps found a null ref, bailed, and never re-ran — nothing was ever observed and the
  // grid kept its startup height, running its tiles under the broadcast bar.
  const trackGridArea = useMemo(
    () => createHeightTracker((h) => setGridAreaHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h))),
    [],
  )

  const broadcastTerminals = useMemo(
    () => terminals.map((t) => ({ ...t, folderPath: t.path })),
    [terminals],
  )
  // Bumped on every replay so the composer re-seeds even when the same text is chosen twice.
  const [replaySeed, setReplaySeed] = useState<{ text: string; n: number } | null>(null)
  const [autopilotRunning, setAutopilotRunning] = useState<Set<string>>(new Set())
  const [autopilotPanelFor, setAutopilotPanelFor] = useState<string | null>(null)
  const [autopilotDefaults, setAutopilotDefaults] = useState({ costCap: 1.0, maxIterations: 40 })
  // Terminal font is a global setting applied to every xterm panel. Held here
  // so a change in Settings live-applies to all open terminals via props.
  const [terminalFontFamily, setTerminalFontFamily] = useState<string>(DEFAULT_TERMINAL_FONT_FAMILY)
  const [terminalFontSize, setTerminalFontSize] = useState<number>(DEFAULT_TERMINAL_FONT_SIZE)
  // Interface (UI chrome) font — applied to <body> via the --app-font-family
  // CSS variable, so everything that inherits follows it. Independent of the
  // terminal font; xterm sets its own font and is unaffected.
  const [appFontFamily, setAppFontFamily] = useState<string>(DEFAULT_APP_FONT_FAMILY)
  // Interface scale (%) applied to UI chrome via the --ui-scale CSS variable
  // and the .ui-scaled class. Terminals never carry that class, so unaffected.
  const [uiScalePct, setUiScalePct] = useState<number>(DEFAULT_UI_SCALE_PCT)


  // Push the interface font onto :root as --app-font-family; body and every
  // element using font-family: inherit picks it up. Runs on mount and whenever
  // the setting changes (after Settings is saved/closed).
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-family', appFontFamily)
  }, [appFontFamily])

  // Push the interface scale onto :root as zoom factors. --ui-scale (sidebar &
  // 12px-base chrome) is rebased so 100% matches the terminal; --ui-scale-plain
  // (menus/dialogs authored at final size) is the raw percentage only.
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(chromeScale(uiScalePct)))
    document.documentElement.style.setProperty('--ui-scale-plain', String(uiScaleFactor(uiScalePct)))
  }, [uiScalePct])

  // Track terminal busy/idle state + notification sound
  const notifyRef = useRef(false)
  useEffect(() => { notifyRef.current = notifyOnIdle }, [notifyOnIdle])

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((message: string, kind: 'info' | 'warn' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, kind })
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const openExternalTerminalAt = useCallback((path: string, id?: string) => {
    window.api.terminalOpenExternal({ folderPath: path, id })
      .then((res) => { if (!res.ok) showToast(res.error || 'Could not open a terminal', 'warn') })
      .catch(() => showToast('Could not open a terminal', 'warn'))
  }, [showToast])


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
      // A minimized terminal going idle just finished something the user
      // can't see — flag its taskbar chip until it's restored.
      if (!busy && minimizedRef.current.has(id)) {
        setAttentionIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      }
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
        setGrokArgs(settings.grokArgs ?? '')
        setOpencodeArgs(settings.opencodeArgs ?? '')
        setProjectAgents(settings.projectAgents ?? {})
        setAskBeforeLaunch(settings.askBeforeLaunch)
        setNotifyOnIdle(settings.notifyOnIdle)
        setProjectsRoot(settings.projectsRoot)
        setDefaultViewMode(settings.defaultViewMode)
        setFavoriteFolders(settings.favoriteFolders ?? [])
        setRestoreSessionEnabled(settings.restoreSessionEnabled ?? false)
        setRestoreSessionResume(settings.restoreSessionResume ?? false)
        setTerminalFontFamily(resolveTerminalFontFamily(settings.terminalFontFamily))
        setTerminalFontSize(clampTerminalFontSize(settings.terminalFontSize))
        setAppFontFamily(resolveAppFontFamily(settings.appFontFamily))
        setUiScalePct(clampUiScalePct(settings.uiScalePct))
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
        grokArgs: t.grokArgs ?? '',
        opencodeArgs: t.opencodeArgs ?? '',
        isPlainShell: t.isPlainShell ?? false,
        minimized: minimizedIds.has(t.id),
      }))
      window.api.sessionSaveLast({ savedAt: Date.now(), projects }).catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [terminals, restoreSessionEnabled, minimizedIds])

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
        grokArgs: t.grokArgs ?? '',
        opencodeArgs: t.opencodeArgs ?? '',
        isPlainShell: t.isPlainShell ?? false,
        minimized: minimizedIds.has(t.id),
      }))
      void window.api.sessionSaveLast({ savedAt: Date.now(), projects })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [terminals, restoreSessionEnabled, minimizedIds])

  // While the close-terminal dialog is up, warn about work that would not be
  // reachable from another machine: uncommitted changes and unpushed commits.
  useEffect(() => {
    setCloseWarning(null)
    if (!closingId) return
    const path = terminals.find((t) => t.id === closingId)?.path
    if (!path) return
    let cancelled = false
    window.api.gitStatus(path, true).then((s) => {
      if (cancelled) return
      const parts: string[] = []
      if (s.dirty) parts.push('uncommitted changes')
      if (s.ahead > 0) parts.push(`${s.ahead} unpushed commit${s.ahead === 1 ? '' : 's'}`)
      if (parts.length > 0) setCloseWarning(`⚠ This project has ${parts.join(' and ')}.`)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [closingId, terminals])

  // Main asks us to confirm closing the whole window (in-app dialog instead
  // of the old native message box). Reply comes via windowConfirmClose().
  useEffect(() => {
    const unsub = window.api.onWindowCloseRequest(() => setShowCloseWindow(true))
    return unsub
  }, [])

  // Same warning for the close-all and close-window dialogs, across every
  // open project.
  useEffect(() => {
    setCloseAllWarning(null)
    if (!showCloseAll && !showCloseWindow) return
    let cancelled = false
    const paths = [...new Set(terminals.map((t) => t.path))]
    Promise.all(paths.map(async (p) => {
      try { return { path: p, status: await window.api.gitStatus(p, true) } } catch { return null }
    })).then((checks) => {
      if (cancelled) return
      const name = (p: string): string => p.split(/[\\/]/).pop() || p
      const dirty = checks.filter((c) => c?.status.dirty).map((c) => name(c!.path))
      const unpushed = checks.filter((c) => c?.status.ahead).map((c) => name(c!.path))
      const lines: string[] = []
      if (dirty.length > 0) lines.push(`⚠ Uncommitted changes in: ${dirty.join(', ')}`)
      if (unpushed.length > 0) lines.push(`⚠ Unpushed commits in: ${unpushed.join(', ')}`)
      if (lines.length > 0) setCloseAllWarning(lines.join('\n'))
    })
    return () => { cancelled = true }
  }, [showCloseAll, showCloseWindow, terminals])

  // Listen for sessions created remotely
  useEffect(() => {
    const unsub = window.api.onRemoteSessionCreated((session) => {
      // Recorded outside the state updater: an updater can run twice under StrictMode,
      // and this writes to disk. A session started from the phone is still a choice for
      // that folder, so opening it later on the desktop should reuse it.
      const remoteCli = normalizeAgentCli(session.agentCli)
      rememberProjectAgent(session.path, remoteCli, getArgsForAgent(remoteCli, {
        claudeArgs: session.claudeArgs,
        codexArgs: session.codexArgs ?? '',
        grokArgs: session.grokArgs ?? '',
        opencodeArgs: session.opencodeArgs ?? '',
      }))
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
          grokArgs: session.grokArgs ?? '',
          opencodeArgs: session.opencodeArgs ?? '',
        }
        const next = [...prev, newEntry]
        if (prev.length === 0 && defaultViewMode === 'focused') {
          setViewMode({ type: 'focused', terminalId: session.id })
        }
        setLayouts(layoutsForVisible(next, minimizedRef.current))
        return next
      })
    })
    return unsub
  }, [defaultViewMode, rememberProjectAgent])

  // Actually create a terminal with a specific agent CLI + args.
  const createTerminal = useCallback((folderPath: string, args: string, agentCli: AgentCli = defaultAgentCli) => {
    const normalizedAgent = normalizeAgentCli(agentCli)
    rememberProjectAgent(folderPath, normalizedAgent, args)
    const usedColors = terminals.map((t) => t.color)
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: folderPath,
      name: folderPath.split(/[\\/]/).pop() || folderPath,
      color: assignColor(usedColors),
      agentCli: normalizedAgent,
      claudeArgs: normalizedAgent === 'claude' ? args : '',
      codexArgs: normalizedAgent === 'codex' ? args : '',
      grokArgs: normalizedAgent === 'grok' ? args : '',
      opencodeArgs: normalizedAgent === 'opencode' ? args : '',
    }

    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)
    if (terminals.length === 0 && defaultViewMode === 'focused') {
      setViewMode({ type: 'focused', terminalId: newEntry.id })
    }

    const newLayouts = layoutsForVisible(newTerminals, minimizedRef.current)
    setLayouts(newLayouts)

    window.api.recentAdd(folderPath).then(() => {
      return window.api.recentList()
    }).then((list) => {
      setRecentFolders(list)
    }).catch(() => {})

  }, [defaultAgentCli, defaultViewMode, terminals, showToast, rememberProjectAgent])

  // Start the folder-open flow (may show dialog or launch directly).
  // Pass agentOverride to force a specific CLI — used by the right-click
  // menu so a project can have both a Claude and a Codex session running
  // side by side.
  const startAddFolder = useCallback((folderPath: string, agentOverride?: AgentCli) => {
    const name = folderPath.split(/[\\/]/).pop() || folderPath
    const argsByAgent = { claude: claudeArgs, codex: codexArgs, grok: grokArgs, opencode: opencodeArgs }
    const { agentCli, args } = resolveProjectLaunch({
      remembered: projectAgents[folderPath],
      agentOverride,
      defaultAgentCli,
      argsSettings: { claudeArgs, codexArgs, grokArgs, opencodeArgs },
    })
    if (askBeforeLaunch) {
      setPendingLaunch({ path: folderPath, name, agentCli, args, argsByAgent })
    } else {
      createTerminal(folderPath, args, agentCli)
    }
  }, [askBeforeLaunch, claudeArgs, codexArgs, grokArgs, opencodeArgs, createTerminal, defaultAgentCli, projectAgents])

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

    const newLayouts = layoutsForVisible(newTerminals, minimizedRef.current)
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
    setMinimizedIds(new Set())
    setAttentionIds(new Set())
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
      grok: stripResumeArgsForQuickLaunch('grok', grokArgs),
      opencode: stripResumeArgsForQuickLaunch('opencode', opencodeArgs),
    }
    const quickArgs = getArgsForAgent(agentCli, {
      claudeArgs: argsByAgent.claude,
      codexArgs: argsByAgent.codex,
      grokArgs: argsByAgent.grok,
      opencodeArgs: argsByAgent.opencode,
    })
    const name = homeDir.split(/[\\/]/).pop() || homeDir
    if (askBeforeLaunch) {
      setPendingLaunch({ path: homeDir, name, agentCli, args: quickArgs, argsByAgent })
    } else {
      createTerminal(homeDir, quickArgs, agentCli)
    }
  }, [askBeforeLaunch, claudeArgs, codexArgs, grokArgs, opencodeArgs, createTerminal, defaultAgentCli])

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
    const newLayouts = layoutsForVisible(newTerminals, minimizedRef.current)
    setLayouts(newLayouts)
    // Deliberately NOT recorded in recents. This is a scratch shell in the
    // home folder, not a project the user opened — recording it spent a
    // recents slot on ~/ and pushed a real project out. The admin-shell
    // variant below has never recorded one either.
  }, [defaultViewMode, terminals])

  // Windows-only. In-grid admin tile when an elevation bridge (gsudo / sudo
  // inline) can relay the elevated shell into our pty; otherwise a separate
  // elevated OS window via the UAC prompt.
  const handleQuickShellAdmin = useCallback(async () => {
    try {
      const mode = await window.api.adminShellMode()
      if (mode === 'in-app') {
        const homeDir = await window.api.getHomeDir()
        const folderName = homeDir.split(/[\\/]/).pop() || homeDir
        const usedColors = terminals.map((t) => t.color)
        const newEntry: TerminalEntry = {
          id: crypto.randomUUID(),
          path: homeDir,
          name: `${folderName} (admin shell)`,
          color: assignColor(usedColors),
          isPlainShell: true,
          elevated: true,
        }
        const newTerminals = [...terminals, newEntry]
        setTerminals(newTerminals)
        if (terminals.length === 0 && defaultViewMode === 'focused') {
          setViewMode({ type: 'focused', terminalId: newEntry.id })
        }
        const newLayouts = layoutsForVisible(newTerminals, minimizedRef.current)
        setLayouts(newLayouts)
        return
      }
      const res = await window.api.openAdminShell()
      // cancelled = user declined the UAC prompt; stay silent for that.
      if (!res.ok) showToast(`Admin shell failed: ${res.error || 'unknown error'}`, 'warn')
      else if (!res.cancelled) showToast('Admin shell opened in a separate window — install gsudo or enable Windows sudo (inline) to host it in the grid', 'info')
    } catch {
      showToast('Admin shell failed to launch', 'warn')
    }
  }, [showToast, terminals, defaultViewMode])

  const handleToggleFavorite = useCallback((path: string) => {
    setFavoriteFolders((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
      window.api.settingsSet('favoriteFolders', next)
      return next
    })
  }, [])

  const handleRemoveRecent = useCallback(async (path: string) => {
    try {
      await window.api.recentRemove(path)
      const current = await window.api.recentList()
      setRecentFolders(current)
    } catch {
      // best-effort
    }
  }, [])

  const handleReopenSavedSession = useCallback((resumeOverride?: boolean) => {
    const resume = resumeOverride ?? restoreSessionResume
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
        const { agentCli, argsByAgent } = resolveRestoredSession(p, resume)
        return p.isPlainShell
          ? { id: crypto.randomUUID(), path: p.path, name: `${folderName} (shell)`, color, isPlainShell: true }
          : {
              id: crypto.randomUUID(),
              path: p.path,
              name: folderName,
              color,
              agentCli,
              claudeArgs: argsByAgent.claude,
              codexArgs: argsByAgent.codex,
              grokArgs: argsByAgent.grok,
              opencodeArgs: argsByAgent.opencode,
            }
      })
      const next = [...prev, ...newEntries]
      const restoredMinimized = minimizedIdsFromRestore(newEntries, savedSessionProjects)
      const nextMinimized = new Set([...minimizedRef.current, ...restoredMinimized])
      if (restoredMinimized.length > 0) setMinimizedIds(nextMinimized)
      const visibleNew = newEntries.filter((e) => !nextMinimized.has(e.id))
      if (prev.length === 0 && defaultViewMode === 'focused' && visibleNew.length > 0) {
        setViewMode({ type: 'focused', terminalId: visibleNew[0].id })
      }
      setLayouts(layoutsForVisible(next, nextMinimized))
      return next
    })
    for (const p of savedSessionProjects) {
      window.api.recentAdd(p.path).catch(() => {})
      // A restored session is the folder's most recent agent choice too. Stored without
      // the resume flags `ensureResumeArgs` adds for this launch — those belong to the
      // restore, not to the project, and would otherwise accumulate on every open.
      if (!p.isPlainShell) {
        const { agentCli, rememberArgs } = resolveRestoredSession(p, resume)
        rememberProjectAgent(p.path, agentCli, rememberArgs)
      }
    }
    setWelcomeDismissed(true)
  }, [savedSessionProjects, defaultViewMode, restoreSessionResume, rememberProjectAgent])

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

    const newLayouts = layoutsForVisible(newTerminals, minimizedRef.current)
    setLayouts(newLayouts)
    setClosingId(null)
    setMinimizedIds((prev) => {
      if (!prev.has(closingId)) return prev
      const next = new Set(prev)
      next.delete(closingId)
      return next
    })
    setAttentionIds((prev) => {
      if (!prev.has(closingId)) return prev
      const next = new Set(prev)
      next.delete(closingId)
      return next
    })
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === closingId
        ? { type: 'grid' }
        : prev
    )
  }, [closingId, terminals])

  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setLayouts(layout)
  }, [])

  const handleMinimize = useCallback((id: string) => {
    if (minimizedIds.has(id)) return
    const next = new Set(minimizedIds).add(id)
    setMinimizedIds(next)
    setLayouts(layoutsForVisible(terminals, next))
    // Minimizing the focused terminal drops back to the grid.
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === id ? { type: 'grid' } : prev
    )
  }, [terminals, minimizedIds])

  const handleRestore = useCallback((id: string) => {
    if (!minimizedIds.has(id)) return
    const next = new Set(minimizedIds)
    next.delete(id)
    setMinimizedIds(next)
    setAttentionIds((prev) => {
      if (!prev.has(id)) return prev
      const pruned = new Set(prev)
      pruned.delete(id)
      return pruned
    })
    setLayouts(layoutsForVisible(terminals, next))
  }, [terminals, minimizedIds])

  const handleNewWindow = useCallback(() => {
    window.api.windowCreate()
  }, [])

  const handleSelectTerminal = useCallback((id: string) => {
    // Selecting a minimized terminal restores it first (taskbar semantics),
    // then the usual toggle: focus it, or back to grid if already focused.
    if (minimizedIds.has(id)) {
      handleRestore(id)
      setViewMode({ type: 'focused', terminalId: id })
      return
    }
    setViewMode((prev) =>
      prev.type === 'focused' && prev.terminalId === id
        ? { type: 'grid' }
        : { type: 'focused', terminalId: id }
    )
  }, [minimizedIds, handleRestore])

  const handleShowAll = useCallback(() => {
    setViewMode({ type: 'grid' })
  }, [])

  const handleSettingsClosed = useCallback(() => {
    setShowSettings(false)
    window.api.settingsGetAll().then((s) => {
      setDefaultAgentCli(normalizeAgentCli(s.defaultAgentCli))
      setClaudeArgs(s.claudeArgs)
      setCodexArgs(s.codexArgs ?? '')
      setGrokArgs(s.grokArgs ?? '')
      setOpencodeArgs(s.opencodeArgs ?? '')
      setAskBeforeLaunch(s.askBeforeLaunch)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      setDefaultViewMode(s.defaultViewMode)
      setRestoreSessionEnabled(s.restoreSessionEnabled ?? false)
      setRestoreSessionResume(s.restoreSessionResume ?? false)
      setTerminalFontFamily(resolveTerminalFontFamily(s.terminalFontFamily))
      setTerminalFontSize(clampTerminalFontSize(s.terminalFontSize))
      setAppFontFamily(resolveAppFontFamily(s.appFontFamily))
      setUiScalePct(clampUiScalePct(s.uiScalePct))
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
      // Mod+1-9: switch to terminal by index (restoring it if minimized)
      if (mod && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        if (idx < terminals.length) {
          const target = terminals[idx]
          if (minimizedRef.current.has(target.id)) handleRestore(target.id)
          setViewMode({ type: 'focused', terminalId: target.id })
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
      // Mod+B: toggle the broadcast bar
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        setBroadcastOpen((v) => !v)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [terminals, handleAddFolder, handleRestore])

  const visibleTerminals = terminals.filter((t) => !minimizedIds.has(t.id))
  const gridRows = getRowCount(visibleTerminals.length)
  // Sized from the grid's own container, not window.innerHeight. The broadcast bar and
  // taskbar are siblings that take real space, so measuring the window made terminals
  // compute a height larger than the box they sit in — they ran on underneath the bar,
  // which read as the bar overlapping them.
  const rowHeight = Math.max(120, Math.floor(gridAreaHeight / gridRows) - 4)
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
        onAddFolder={handleAddFolder}
        onQuickAgent={handleQuickAgent}
        onQuickShell={handleQuickShell}
        onQuickShellContextMenu={window.api.platform === 'win32' ? (x, y) => setQuickShellMenu({ x, y }) : undefined}
        onNewWindow={handleNewWindow}
        onNewProject={() => setShowNewProject(true)}
        onOpenSettings={() => setShowSettings(true)}
        onToggleBroadcast={() => setBroadcastOpen((v) => !v)}
        broadcastActive={broadcastOpen}
        hasProjectsRoot={Boolean(projectsRoot)}
        uiScale={chromeScale(uiScalePct)}
      />
      {/* Content column: the terminal area shrinks to make room for the
          broadcast bar docked underneath, rather than being overlapped. */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div ref={trackGridArea} style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <ErrorBoundary>
        {terminals.length === 0 && savedSessionProjects.length > 0 && !welcomeDismissed && (
          <WelcomeBackCard
            count={savedSessionProjects.length}
            resumeDefault={restoreSessionResume}
            onReopen={handleReopenSavedSession}
            onDismiss={() => setWelcomeDismissed(true)}
          />
        )}
        {terminals.length === 0 && (savedSessionProjects.length === 0 || welcomeDismissed) && (
          <EmptyWorkspace />
        )}

        {/* All terminals minimized — the grid is empty but sessions live on
            in the taskbar below */}
        {terminals.length > 0 && visibleTerminals.length === 0 && !isFocused && (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#666', fontSize: '13px', fontFamily: 'monospace',
          }}>
            All terminals minimized — restore from the taskbar below
          </div>
        )}

        {/* Grid mode */}
        {visibleTerminals.length > 0 && !isFocused && (
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
            {visibleTerminals.map((t) => (
              <div key={t.id}>
                <TerminalPanel
                  id={t.id}
                  folderPath={t.path}
                  folderName={t.name}
                  color={t.color}
                  agentCli={t.agentCli}
                  claudeArgs={t.claudeArgs}
                  codexArgs={t.codexArgs}
                  grokArgs={t.grokArgs}
                  opencodeArgs={t.opencodeArgs}
                  isPlainShell={t.isPlainShell}
                  elevated={t.elevated}
                  fontFamily={terminalFontFamily}
                  fontSize={terminalFontSize}
                  onClose={() => handleRequestClose(t.id)}
                  onMinimize={() => handleMinimize(t.id)}
                  onToggleMaximize={() => handleSelectTerminal(t.id)}
                  isMaximized={false}
                  onSpawnShell={() => handleSpawnShell(t.path, t.color)}
                  onOpenMarkdown={setMarkdownFile}
                  onStartAutopilot={() => setAutopilotKickoffFor(t.id)}
                  isAutopilotRunning={autopilotRunning.has(t.id)}
                  onShowAutopilotPanel={() => setAutopilotPanelFor(t.id)}
                  onNotify={showToast}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}

        {/* Focused mode — visible terminals rendered, only focused one shown */}
        {isFocused && visibleTerminals.map((t) => (
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
              grokArgs={t.grokArgs}
              opencodeArgs={t.opencodeArgs}
              isPlainShell={t.isPlainShell}
              elevated={t.elevated}
              fontFamily={terminalFontFamily}
              fontSize={terminalFontSize}
              onClose={() => handleRequestClose(t.id)}
              onMinimize={() => handleMinimize(t.id)}
              onToggleMaximize={() => handleSelectTerminal(t.id)}
              isMaximized={viewMode.terminalId === t.id}
              onSpawnShell={() => handleSpawnShell(t.path, t.color)}
              onOpenMarkdown={setMarkdownFile}
              onStartAutopilot={() => setAutopilotKickoffFor(t.id)}
              isAutopilotRunning={autopilotRunning.has(t.id)}
              onShowAutopilotPanel={() => setAutopilotPanelFor(t.id)}
              onNotify={showToast}
            />
          </div>
        ))}
        </ErrorBoundary>
      </div>
      <TaskBar
        items={terminals
          .filter((t) => minimizedIds.has(t.id))
          .map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            busy: busyTerminals.has(t.id),
            attention: attentionIds.has(t.id),
          }))}
        onRestore={handleRestore}
        onClose={handleRequestClose}
      />
      {broadcastOpen && (
        <BroadcastBar
          terminals={broadcastTerminals}
          onClose={() => setBroadcastOpen(false)}
          onOpenHistory={() => setHistoryOpen(true)}
          seed={replaySeed}
          selection={broadcastSelection}
          onSelectionChange={setBroadcastSelection}
        />
      )}
      </div>

      {historyOpen && (
        <PromptHistory
          onClose={() => setHistoryOpen(false)}
          onReplay={(text) => {
            // Replay puts the text in the composer rather than resending: targets are
            // chosen there, which is what makes sending to a different project possible.
            setReplaySeed((prev) => ({ text, n: (prev?.n ?? 0) + 1 }))
            setHistoryOpen(false)
            setBroadcastOpen(true)
          }}
        />
      )}

      {autopilotPanelFor && (
        <AutopilotPanel
          terminalId={autopilotPanelFor}
          onClose={() => setAutopilotPanelFor(null)}
        />
      )}


      {closingId && (
        <ConfirmDialog
          message={`Close terminal for "${terminals.find((t) => t.id === closingId)?.name}"?`}
          detail={closeWarning ?? undefined}
          onConfirm={handleConfirmClose}
          onCancel={() => setClosingId(null)}
        />
      )}

      {showCloseAll && (
        <ConfirmDialog
          message={`Close all ${terminals.length} terminal${terminals.length !== 1 ? 's' : ''}?`}
          detail={closeAllWarning ?? undefined}
          confirmLabel="Close All"
          onConfirm={handleConfirmCloseAll}
          onCancel={() => setShowCloseAll(false)}
        />
      )}

      {showCloseWindow && (
        <ConfirmDialog
          message="Close this window?"
          detail={[
            `${terminals.length} terminal session${terminals.length !== 1 ? 's' : ''} will be terminated.`,
            ...(closeAllWarning ? ['', closeAllWarning] : []),
          ].join('\n')}
          confirmLabel="Close Window"
          onConfirm={() => { setShowCloseWindow(false); window.api.windowConfirmClose() }}
          onCancel={() => setShowCloseWindow(false)}
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

      {quickShellMenu && (
        <ContextMenu
          x={quickShellMenu.x}
          y={quickShellMenu.y}
          onClose={() => setQuickShellMenu(null)}
          items={[
            { label: 'Open Quick Shell', icon: TerminalSquare, onClick: handleQuickShell },
            { label: 'Run as administrator…', icon: Shield, onClick: handleQuickShellAdmin },
          ]}
        />
      )}

      {contextMenu && (() => {
        const path = contextMenu.path
        const isFav = favoriteFolders.includes(path)
        const runningAgents = new Set(
          terminals
            .filter((t) => t.path === path && !t.isPlainShell)
            .map((t) => normalizeAgentCli(t.agentCli)),
        )
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              ...AGENT_CLIS.map((cli) => ({
                label: runningAgents.has(cli) ? `Open another ${AGENT_CLI_LABELS[cli]}` : `Open with ${AGENT_CLI_LABELS[cli]}`,
                icon: TerminalSquare,
                onClick: () => startAddFolder(path, cli),
              })),
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
              { label: '', divider: true, onClick: () => {} },
              { label: isFav ? 'Remove from favorites' : 'Add to favorites', icon: Star, onClick: () => handleToggleFavorite(path) },
              // One entry per detected terminal: on Windows that is typically Windows
              // Terminal, PowerShell and Command Prompt, so the choice is explicit
              // rather than whatever the app decides is best.
              ...externalTerminals.map((t) => ({
                label: `Open in ${t.name}`,
                icon: TerminalSquare,
                onClick: () => openExternalTerminalAt(path, t.id),
              })),
              { label: 'Open in Explorer', icon: FolderSearch, onClick: () => { window.api.openInExplorer(path).catch(() => {}) } },
              { label: 'Open in Editor', icon: Code, onClick: () => { window.api.openInEditor(path).then((res) => { if (!res.ok) showToast(res.error || 'Could not open in editor', 'warn') }).catch(() => showToast('Could not open in editor', 'warn')) } },
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
          <div className="ui-scaled" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
               onClick={() => setAutopilotKickoffFor(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: '90%' }}>
              <AutopilotKickoff
                terminalId={t.id}
                projectPath={t.path}
                agentCli={normalizeAgentCli(t.agentCli)}
                launchArgs={getArgsForAgent(normalizeAgentCli(t.agentCli), { claudeArgs: t.claudeArgs, codexArgs: t.codexArgs, grokArgs: t.grokArgs, opencodeArgs: t.opencodeArgs })}
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
        <div className="ui-scaled" style={{
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
