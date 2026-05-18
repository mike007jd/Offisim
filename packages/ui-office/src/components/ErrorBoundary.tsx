import { Button } from '@offisim/ui-core';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface p-8">
          <div className="max-w-lg rounded-lg border border-error/30 bg-surface-elevated p-6 text-text-primary">
            <h2 className="mb-2 text-lg font-semibold text-error">Something went wrong</h2>
            <p className="mb-4 text-sm text-text-muted">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <Button type="button" onClick={this.handleReset}>
              Try Again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
