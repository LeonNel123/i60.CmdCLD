import { useState, useEffect } from 'react'
import { marked } from 'marked'

interface MarkdownViewerProps {
  filePath: string
  onClose: () => void
}

export function MarkdownViewer({ filePath, onClose }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const fileName = filePath.split(/[\\/]/).pop() || filePath

  useEffect(() => {
    window.api.readFile(filePath).then((text) => {
      if (text === null) {
        setError(true)
      } else {
        setContent(text)
      }
    })
  }, [filePath])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const html = content ? marked.parse(content, { async: false }) as string : ''

  return (
    <>
    <style>{`
      .markdown-body { font-family: inherit; }
      .markdown-body code,
      .markdown-body pre { font-family: Menlo, Consolas, monospace; }
    `}</style>
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 4000,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1e1e',
          borderRadius: '8px',
          border: '1px solid #333',
          width: '85%',
          maxWidth: '900px',
          height: '85%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#252526',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}>
          <span style={{
            color: '#ccc',
            fontSize: '13px',
            fontFamily: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {fileName}
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => window.api.openInEditor(filePath)}
              title="Open in editor"
              style={{
                background: 'none', border: 'none', color: '#888',
                cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit',
              }}
            >
              &#9998; Edit
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: '#666',
                cursor: 'pointer', fontSize: '16px', padding: '0 4px',
              }}
            >
              &#10005;
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 32px',
        }}>
          {error ? (
            <div style={{ color: '#f14c4c', fontFamily: 'inherit', fontSize: '13px' }}>
              Failed to read file: {filePath}
            </div>
          ) : content === null ? (
            <div style={{ color: '#666', fontFamily: 'inherit', fontSize: '13px' }}>
              Loading...
            </div>
          ) : (
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>
    </>
  )
}
