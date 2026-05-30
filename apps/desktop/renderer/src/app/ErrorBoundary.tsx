import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordLastError } from './last-error.js';

interface Props {
  children: ReactNode;
  /**
   * When set, render this instead of the full-screen error panel (scene-local).
   * Receives a `reset` callback so the host can offer its own recovery affordance.
   */
  fallback?: ReactNode | ((reset: () => void) => ReactNode);
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
    recordLastError(
      `error-boundary:${this.props.label ?? 'root'}`,
      `${error.stack ?? error.message}\n--- component stack ---${info.componentStack ?? ''}`,
    );
  }

  reset = () => this.setState({ error: null, info: '' });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.reset)
        : this.props.fallback;
    }
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
        <button type="button" className="off-error-boundary__reset" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
