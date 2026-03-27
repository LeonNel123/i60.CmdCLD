import { useState, useEffect, useCallback, useRef } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Sidebar } from './components/Sidebar'
import { TerminalPanel, killPty } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { LaunchDialog } from './components/LaunchDialog'
import { MarkdownViewer } from './components/MarkdownViewer'
import { assignColor } from './utils/colors'
import { calculateLayout, getRowCount } from './utils/grid-layout'
import { onActivityChange } from './utils/terminal-activity'
import notificationSound from './assets/notification.wav'
import type { MultiWindowState, RecentFolder } from './types/api'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
  claudeArgs?: string
  isPlainShell?: boolean
}

type ViewMode = { type: 'grid' } | { type: 'focused'; terminalId: string }

export default function App() {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>({ type: 'grid' })
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [pendingLaunch, setPendingLaunch] = useState<{ path: string; name: string } | null>(null)
  const [busyTerminals, setBusyTerminals] = useState<Set<string>>(new Set())
  const [claudeArgs, setClaudeArgs] = useState('--dangerously-skip-permissions')
  const [askBeforeLaunch, setAskBeforeLaunch] = useState(false)
  const [notifyOnIdle, setNotifyOnIdle] = useState(false)
  const [projectsRoot, setProjectsRoot] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [markdownFile, setMarkdownFile] = useState<string | null>(null)

  // Track terminal busy/idle state + notification sound
  const notifyRef = useRef(false)
  useEffect(() => { notifyRef.current = notifyOnIdle }, [notifyOnIdle])

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
    const settingsPromise = window.api.settingsGetAll().then((s) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
      return s
    }).catch(() => null)

    window.api.recentList().then(setRecentFolders).catch(() => {})

    const isEmptyWindow = new URLSearchParams(window.location.search).has('empty')
    if (isEmptyWindow) {
      setLoaded(true)
      return
    }

    Promise.all([settingsPromise, window.api.loadState()]).then(([s, state]) => {
      if (state?.windows?.length) {
        const win = state.windows[0]
        if (win?.folders?.length) {
          const entries: TerminalEntry[] = win.folders.map((f) => ({
            id: crypto.randomUUID(),
            path: f.path,
            name: f.path.split(/[\\/]/).pop() || f.path,
            color: f.color,
          }))
          setTerminals(entries)

          const hasLayouts = win.folders.every((f) => f.layout)
          if (hasLayouts) {
            setLayouts(entries.map((e, i) => ({
              ...win.folders[i].layout,
              i: e.id,
            })))
          } else {
            setLayouts(calculateLayout(entries.length).map((pos, i) => ({
              ...pos,
              i: entries[i].id,
            })))
          }

          // Apply default view mode — focus first terminal if set to 'focused'
          if (s?.defaultViewMode === 'focused' && entries.length > 0) {
            setViewMode({ type: 'focused', terminalId: entries[0].id })
          }
        }
      }
      setLoaded(true)
    })
  }, [])

  // Save state whenever terminals or layouts change (debounced)
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      const state: MultiWindowState = {
        windows: [{
          id: 'current',
          bounds: { width: 0, height: 0, x: 0, y: 0 },
          sidebarCollapsed: false,
          viewMode: viewMode.type === 'grid' ? 'grid' : { focused: viewMode.terminalId },
          folders: terminals.map((t) => {
            const l = layouts.find((lay) => lay.i === t.id)
            return {
              path: t.path,
              color: t.color,
              layout: l
                ? { x: l.x, y: l.y, w: l.w, h: l.h }
                : { x: 0, y: 0, w: 12, h: 1 },
            }
          }),
        }],
      }
      window.api.saveState(state)
    }, 500)
    return () => clearTimeout(timer)
  }, [terminals, layouts, loaded, viewMode])

  // Actually create a terminal with specific args
  const createTerminal = useCallback((folderPath: string, args: string) => {
    const usedColors = terminals.map((t) => t.color)
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: folderPath,
      name: folderPath.split(/[\\/]/).pop() || folderPath,
      color: assignColor(usedColors),
      claudeArgs: args,
    }

    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)

    window.api.recentAdd(folderPath).catch(() => {})
  }, [terminals])

  // Start the folder-open flow (may show dialog or launch directly)
  const startAddFolder = useCallback((folderPath: string) => {
    const name = folderPath.split(/[\\/]/).pop() || folderPath
    if (askBeforeLaunch) {
      setPendingLaunch({ path: folderPath, name })
    } else {
      createTerminal(folderPath, claudeArgs)
    }
  }, [askBeforeLaunch, claudeArgs, createTerminal])

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

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
  }, [terminals])

  const handleAddFolder = useCallback(async () => {
    const folderPath = await window.api.selectFolder()
    if (!folderPath) return
    startAddFolder(folderPath)
  }, [startAddFolder])

  const handleOpenRecent = useCallback((path: string) => {
    startAddFolder(path)
  }, [startAddFolder])

  const handleLaunchConfirm = useCallback((args: string) => {
    if (!pendingLaunch) return
    createTerminal(pendingLaunch.path, args)
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
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
      setNotifyOnIdle(s.notifyOnIdle)
      setProjectsRoot(s.projectsRoot)
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+1-9: switch to terminal by index
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        if (idx < terminals.length) {
          setViewMode({ type: 'focused', terminalId: terminals[idx].id })
          e.preventDefault()
        }
        return
      }
      // Ctrl+T: add folder
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        handleAddFolder()
        return
      }
      // Ctrl+`: show all (grid view)
      if (e.ctrlKey && e.key === '`') {
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

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#1e1e1e' }}>
      <Sidebar
        terminals={terminals}
        viewMode={viewMode}
        busyTerminals={busyTerminals}
        onSelectTerminal={handleSelectTerminal}
        onShowAll={handleShowAll}
        onAddFolder={handleAddFolder}
        onNewWindow={handleNewWindow}
        recentFolders={recentFolders}
        onOpenRecent={handleOpenRecent}
        onOpenSettings={() => setShowSettings(true)}
        onNewProject={() => setShowNewProject(true)}
        hasProjectsRoot={!!projectsRoot}
      />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {terminals.length === 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#555',
            fontSize: '16px',
          }}>
            Click "+ Add Folder" to start a Claude session
          </div>
        )}

        {/* Always render grid — hide with visibility when focused so terminals stay mounted */}
        {terminals.length > 0 && (
          <div style={{
            height: '100%',
            visibility: isFocused ? 'hidden' : 'visible',
            position: isFocused ? 'absolute' : 'relative',
            inset: 0,
          }}>
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
                    claudeArgs={t.claudeArgs}
                    isPlainShell={t.isPlainShell}
                    onClose={() => handleRequestClose(t.id)}
                    onSpawnShell={() => handleSpawnShell(t.path, t.color)}
                    onOpenMarkdown={setMarkdownFile}
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          </div>
        )}

        {/* Focused overlay — just a full-screen wrapper that re-renders the focused terminal.
            The grid terminals stay mounted underneath (hidden) to preserve PTY connections. */}
        {isFocused && (() => {
          const t = terminals.find((t) => viewMode.terminalId === t.id)
          if (!t) return null
          return (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              background: '#1e1e1e',
            }}>
              <TerminalPanel
                id={t.id}
                folderPath={t.path}
                folderName={t.name}
                color={t.color}
                claudeArgs={t.claudeArgs}
                isPlainShell={t.isPlainShell}
                onClose={() => handleRequestClose(t.id)}
                onSpawnShell={() => handleSpawnShell(t.path, t.color)}
                onOpenMarkdown={setMarkdownFile}
              />
            </div>
          )
        })()}
      </div>

      {closingId && (
        <ConfirmDialog
          message={`Close terminal for "${terminals.find((t) => t.id === closingId)?.name}"?`}
          onConfirm={handleConfirmClose}
          onCancel={() => setClosingId(null)}
        />
      )}

      {showSettings && (
        <SettingsDialog onClose={handleSettingsClosed} />
      )}

      {pendingLaunch && (
        <LaunchDialog
          folderName={pendingLaunch.name}
          defaultArgs={claudeArgs}
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
                fontSize: '12px', fontFamily: 'Consolas, monospace', outline: 'none',
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
