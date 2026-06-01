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

  private detailText(): string {
    const { error, info } = this.state;
    const head = this.props.label ? `[${this.props.label}] ` : '';
    const body = String(error?.stack ?? error?.message ?? error);
    return info ? `${head}${body}\n--- component stack ---${info}` : `${head}${body}`;
  }

  copyDetails = () => {
    void navigator.clipboard?.writeText(this.detailText());
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.reset)
        : this.props.fallback;
    }
    return (
      <div className="off-error-boundary">
        <div className="off-error-boundary__title">Something went wrong</div>
        <p className="off-error-boundary__msg">
          This view hit an unexpected error. Try again — if it keeps happening, copy the
          details so we can look into it.
        </p>
        <div className="off-error-boundary__actions">
          <button type="button" className="off-error-boundary__reset" onClick={this.reset}>
            Try again
          </button>
        </div>
        <details className="off-error-boundary__details">
          <summary>Technical details</summary>
          <pre className="off-error-boundary__stack">{this.detailText()}</pre>
          <button type="button" className="off-error-boundary__copy" onClick={this.copyDetails}>
            Copy details
          </button>
        </details>
      </div>
    );
  }
}
