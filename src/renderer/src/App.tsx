import { useState, useEffect, useCallback } from 'react'
import { Responsive, WidthProvider, Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { TopBar } from './components/TopBar'
import { TerminalPanel } from './components/TerminalPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { assignColor } from './utils/colors'
import { calculateLayout } from './utils/grid-layout'
import type { SessionState } from './types/api'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface TerminalEntry {
  id: string
  path: string
  name: string
  color: string
}

export default function App() {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load saved state on mount
  useEffect(() => {
    window.api.loadState().then((state) => {
      if (state?.folders?.length) {
        const entries: TerminalEntry[] = state.folders.map((f) => ({
          id: crypto.randomUUID(),
          path: f.path,
          name: f.path.split(/[\\/]/).pop() || f.path,
          color: f.color,
        }))
        setTerminals(entries)

        const hasLayouts = state.folders.every((f) => f.layout)
        if (hasLayouts) {
          setLayouts(entries.map((e, i) => ({
            ...state.folders[i].layout,
            i: e.id,
          })))
        } else {
          setLayouts(calculateLayout(entries.length).map((pos, i) => ({
            ...pos,
            i: entries[i].id,
          })))
        }
      }
      setLoaded(true)
    })
  }, [])

  // Save state whenever terminals or layouts change
  useEffect(() => {
    if (!loaded) return
    const state: SessionState = {
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
      windowBounds: { width: 0, height: 0, x: 0, y: 0 }, // managed by main process
    }
    window.api.saveState(state)
  }, [terminals, layouts, loaded])

  const handleAddFolder = useCallback(async () => {
    const folderPath = await window.api.selectFolder()
    if (!folderPath) return

    const usedColors = terminals.map((t) => t.color)
    const newEntry: TerminalEntry = {
      id: crypto.randomUUID(),
      path: folderPath,
      name: folderPath.split(/[\\/]/).pop() || folderPath,
      color: assignColor(usedColors),
    }

    const newTerminals = [...terminals, newEntry]
    setTerminals(newTerminals)

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
  }, [terminals])

  const handleRequestClose = useCallback((id: string) => {
    setClosingId(id)
  }, [])

  const handleConfirmClose = useCallback(() => {
    if (!closingId) return
    const newTerminals = terminals.filter((t) => t.id !== closingId)
    setTerminals(newTerminals)

    const newLayouts = calculateLayout(newTerminals.length).map((pos, i) => ({
      ...pos,
      i: newTerminals[i].id,
    }))
    setLayouts(newLayouts)
    setClosingId(null)
  }, [closingId, terminals])

  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setLayouts(layout)
  }, [])

  const gridRows = Math.ceil(Math.sqrt(terminals.length || 1))
  const rowHeight = Math.max(150, Math.floor((window.innerHeight - 50) / gridRows) - 12)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0a1a' }}>
      <TopBar count={terminals.length} onAdd={handleAddFolder} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {terminals.length === 0 ? (
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
        ) : (
          <ResponsiveGridLayout
            layouts={{ lg: layouts }}
            breakpoints={{ lg: 0 }}
            cols={{ lg: 12 }}
            rowHeight={rowHeight}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            compactType="vertical"
            margin={[4, 4]}
          >
            {terminals.map((t) => (
              <div key={t.id}>
                <TerminalPanel
                  id={t.id}
                  folderPath={t.path}
                  folderName={t.name}
                  color={t.color}
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
    </div>
  )
}
