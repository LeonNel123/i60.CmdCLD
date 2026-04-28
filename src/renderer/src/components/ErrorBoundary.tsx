import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Catches errors thrown during render or in lifecycle methods of any
// descendant component, so a single component's bug can't blank the
// whole window. Shows a small inline message instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[CmdCLD] ErrorBoundary caught:', error, info)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          padding: 24,
          color: '#ccc',
          fontFamily: 'inherit',
          fontSize: 12,
          textAlign: 'center',
        }}>
          <div style={{ color: '#f87171', fontSize: 14, fontWeight: 600 }}>
            Something went wrong
          </div>
          <div style={{ color: '#888', maxWidth: 480, lineHeight: 1.5 }}>
            {this.state.error.message || 'A component crashed during render or cleanup.'}
          </div>
          <button
            onClick={this.reset}
            style={{
              background: '#22c55e',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
              fontWeight: 600,
              marginTop: 6,
            }}
          >
            Continue
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
