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
      <div className="off-error-boundary">
        <div className="off-error-boundary__title">
          {this.props.label ? `${this.props.label} — ` : ''}Render error
        </div>
        <pre className="off-error-boundary__stack">
          {String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
        </pre>
        {this.state.info ? (
          <pre className="off-error-boundary__info">{this.state.info}</pre>
        ) : null}
      </div>
    );
  }
}
