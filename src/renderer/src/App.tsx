import { useState, useEffect, useCallback } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Sidebar } from './components/Sidebar'
import { TerminalPanel, killPty } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { LaunchDialog } from './components/LaunchDialog'
import { assignColor } from './utils/colors'
import { calculateLayout } from './utils/grid-layout'
import { onActivityChange } from './utils/terminal-activity'
import type { MultiWindowState, RecentFolder } from './types/api'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
  claudeArgs?: string
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

  // Track terminal busy/idle state
  useEffect(() => {
    return onActivityChange((id, busy) => {
      setBusyTerminals((prev) => {
        const next = new Set(prev)
        if (busy) next.add(id)
        else next.delete(id)
        return next
      })
    })
  }, [])

  // Load settings + saved state + recent folders on mount
  useEffect(() => {
    window.api.settingsGetAll().then((s) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
    }).catch(() => {})

    window.api.recentList().then(setRecentFolders).catch(() => {})

    const isEmptyWindow = new URLSearchParams(window.location.search).has('empty')
    if (isEmptyWindow) {
      setLoaded(true)
      return
    }
    window.api.loadState().then((state) => {
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
    // Reload settings
    window.api.settingsGetAll().then((s) => {
      setClaudeArgs(s.claudeArgs)
      setAskBeforeLaunch(s.askBeforeLaunch)
    }).catch(() => {})
  }, [])

  const gridRows = Math.ceil(Math.sqrt(terminals.length || 1))
  const rowHeight = Math.max(150, Math.floor(window.innerHeight / gridRows) - 4)
  const isFocused = viewMode.type === 'focused'

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#0a0a1a' }}>
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

        {isFocused && terminals.map((t) => (
          <div
            key={`focused-${t.id}`}
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
              claudeArgs={t.claudeArgs}
              onClose={() => handleRequestClose(t.id)}
            />
          </div>
        ))}

        {!isFocused && terminals.length > 0 && (
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
                  onClose={() => handleRequestClose(t.id)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
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
    </div>
  )
}
