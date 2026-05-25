import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When set, render this instead of the full-screen error panel (scene-local). */
  fallback?: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * Catches render errors so a throw degrades gracefully instead of unmounting the
 * root into a blank white screen. The full-screen variant prints the message +
 * stack so failures are diagnosable in the release app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info: info.componentStack ?? '' });
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info);
    try {
      localStorage.setItem(
        'offisim:lastError',
        `${this.props.label ?? 'root'}: ${error.stack ?? error.message}\n--- component stack ---${info.componentStack ?? ''}`,
      );
    } catch {
      /* localStorage unavailable */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'auto',
          padding: '32px',
          background: '#fff',
          color: '#0f172a',
          font: '13px/1.5 ui-monospace, monospace',
          zIndex: 99999,
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', color: '#b91c1c' }}>
          {this.props.label ? `${this.props.label} — ` : ''}Render error
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
        </pre>
        {this.state.info ? (
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: '16px', color: '#475569' }}>
            {this.state.info}
          </pre>
        ) : null}
      </div>
    );
  }
}
