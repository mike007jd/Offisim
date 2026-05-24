import { cn } from '@offisim/ui-core';
import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

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
      <div className="workspace-shell-skeleton">
        <div data-size="wide" />
        <div data-size="medium" />
        <div data-size="block" />
        <div data-size="long" />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div data-testid="workspace-error" className="workspace-shell-error">
      <AlertCircle data-icon="workspace-error" />
      <p>{message}</p>
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
  return (
    <div
      className={cn('workspace-shell', className)}
      data-testid={testId}
      data-workspace={workspace}
    >
      {topSlot}

      {loading ? (
        <LoadingSkeleton eyebrow={eyebrow} title={title} />
      ) : (
        <>
          <header className="workspace-shell-header">
            <div className="workspace-shell-header-row">
              <div className="workspace-shell-heading">
                <p className="workspace-shell-eyebrow">{eyebrow}</p>
                <h1 className="workspace-shell-title">{title}</h1>
              </div>
              {actions ? <div className="workspace-shell-actions">{actions}</div> : null}
            </div>
          </header>

          {error ? (
            <ErrorState message={error} />
          ) : empty ? (
            <div data-testid="workspace-empty" className="workspace-shell-body">
              {empty}
            </div>
          ) : (
            <div className="workspace-shell-body">{children}</div>
          )}
        </>
      )}
    </div>
  );
}
