import { useEffect, useState } from 'react'
import { RotateCcw, X } from './icons'

interface WelcomeBackCardProps {
  count: number
  resumeDefault: boolean
  onReopen: (resume: boolean) => void
  onDismiss: () => void
}

export function WelcomeBackCard({ count, resumeDefault, onReopen, onDismiss }: WelcomeBackCardProps) {
  const [resume, setResume] = useState(resumeDefault)
  // Settings load async in App; re-seed if the default arrives after mount.
  useEffect(() => { setResume(resumeDefault) }, [resumeDefault])

  if (count <= 0) return null

  return (
    <div className="ui-scaled" style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: '#1a1a2e',
      border: '1px solid #2d2d2d',
      borderRadius: '8px',
      padding: '20px 22px',
      width: '320px',
      maxWidth: '85%',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      fontFamily: 'inherit',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ color: '#a78bfa', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
          <RotateCcw width={14} height={14} /> Welcome back
        </span>
        <button
          onClick={onDismiss}
          title="Dismiss"
          style={{
            background: 'none', border: 'none', color: '#666', cursor: 'pointer',
            padding: '0 4px', display: 'flex', alignItems: 'center',
          }}
        >
          <X width={14} height={14} />
        </button>
      </div>
      <div style={{ color: '#aaa', fontSize: '12px', lineHeight: 1.5, marginBottom: '10px' }}>
        You had {count} project{count === 1 ? '' : 's'} open last time.
      </div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px',
        cursor: 'pointer', color: '#aaa', fontSize: '12px', fontFamily: 'inherit',
      }}>
        <input
          type="checkbox"
          checked={resume}
          onChange={(e) => setResume(e.target.checked)}
          style={{ accentColor: '#a78bfa' }}
        />
        Resume conversations (--continue)
      </label>
      <button
        onClick={() => onReopen(resume)}
        style={{
          background: '#a78bfa',
          color: '#000',
          border: 'none',
          borderRadius: '4px',
          padding: '6px 14px',
          cursor: 'pointer',
          fontSize: '12px',
          fontFamily: 'inherit',
          fontWeight: 600,
        }}
      >
        Reopen them
      </button>
    </div>
  )
}
