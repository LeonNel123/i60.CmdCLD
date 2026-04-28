import { FolderOpen, Sparkles, TerminalSquare } from './icons'

export function EmptyWorkspace() {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        textAlign: 'left',
        color: '#5a5a6a',
        fontSize: 12,
        lineHeight: 1.8,
        fontFamily: 'inherit',
      }}>
        <div style={{ color: '#888', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Get started</div>
        <Hint icon={<FolderOpen width={14} height={14} />} color="#22c55e">Open a project from the rail or sidebar</Hint>
        <Hint icon={<Sparkles width={14} height={14} />} color="#fb923c">Quick Claude — sandbox session in your home folder</Hint>
        <Hint icon={<TerminalSquare width={14} height={14} />} color="#94a3b8">Quick Shell — plain shell, no Claude</Hint>
      </div>
    </div>
  )
}

function Hint({ icon, color, children }: { icon: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}
