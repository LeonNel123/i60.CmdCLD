import {
  FolderOpen, Sparkles, TerminalSquare, AppWindow, FolderPlus, Settings,
} from './icons'
import { Tooltip } from './Tooltip'

interface IconRailProps {
  onAddFolder: () => void
  onQuickClaude: () => void
  onQuickShell: () => void
  onNewWindow: () => void
  onNewProject: () => void
  onOpenSettings: () => void
  hasProjectsRoot: boolean
}

const RAIL_WIDTH = 36

export function IconRail({
  onAddFolder,
  onQuickClaude,
  onQuickShell,
  onNewWindow,
  onNewProject,
  onOpenSettings,
  hasProjectsRoot,
}: IconRailProps) {
  return (
    <div style={{
      width: RAIL_WIDTH,
      minWidth: RAIL_WIDTH,
      height: '100%',
      background: '#141414',
      borderRight: '1px solid #2d2d2d',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '8px 0',
      flexShrink: 0,
    }}>
      <RailButton title="Open Project — pick a folder to launch Claude in" color="#22c55e" onClick={onAddFolder}>
        <FolderOpen />
      </RailButton>
      <RailButton title="Quick Claude (no folder)" color="#fb923c" onClick={onQuickClaude}>
        <Sparkles />
      </RailButton>
      <RailButton title="Quick Shell — plain shell in your home folder" color="#94a3b8" onClick={onQuickShell}>
        <TerminalSquare />
      </RailButton>
      <RailButton title="New Window" color="#aaa" onClick={onNewWindow}>
        <AppWindow />
      </RailButton>
      {hasProjectsRoot && (
        <RailButton title="New Project" color="#38bdf8" onClick={onNewProject}>
          <FolderPlus />
        </RailButton>
      )}
      <div style={{ flex: 1 }} />
      <RailButton title="Settings" color="#aaa" onClick={onOpenSettings}>
        <Settings />
      </RailButton>
    </div>
  )
}

function RailButton({
  title, color, onClick, children,
}: { title: string; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={title} side="right">
      <button
        onClick={onClick}
        style={{
          width: 28,
          height: 28,
          marginBottom: 6,
          background: 'none',
          border: 'none',
          borderRadius: 4,
          color,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
