import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import './workspace-shell.css';

export interface WorkspacePageShellProps {
  title: string;
  children: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string;
  empty?: ReactNode;
  topSlot?: ReactNode;
  testId?: string;
  workspace?: string;
  className?: string;
}

function LoadingSkeleton({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div data-testid="workspace-loading-skeleton">
      <header className="workspace-shell-header">
        <p className="workspace-shell-eyebrow">{eyebrow}</p>
        <h1 className="workspace-shell-title">{title}</h1>
      </header>
      <div className="workspace-shell-loading-region px-6 py-6 space-y-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
        <div className="h-32 w-full animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      data-testid="workspace-error"
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <AlertCircle className="h-8 w-8 text-error" />
      <p className="max-w-md text-sm text-error">{message}</p>
    </div>
  );
}

export function WorkspacePageShell({
  title,
  children,
  eyebrow = 'Workspace',
  actions,
  loading = false,
  error,
  empty,
  topSlot,
  testId = 'workspace-page-shell',
  workspace,
  className,
}: WorkspacePageShellProps) {
  const rootClassName = ['workspace-shell', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} data-testid={testId} data-workspace={workspace}>
      {topSlot}

      {loading ? (
        <LoadingSkeleton eyebrow={eyebrow} title={title} />
      ) : (
        <>
          <header className="workspace-shell-header">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="workspace-shell-eyebrow">{eyebrow}</p>
                <h1 className="workspace-shell-title">{title}</h1>
              </div>
              {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
          </header>

          {error ? (
            <ErrorState message={error} />
          ) : empty ? (
            <div data-testid="workspace-empty" className="flex-1 min-h-0">
              {empty}
            </div>
          ) : (
            <div className="workspace-shell-content">{children}</div>
          )}
        </>
      )}
    </div>
  );
}
