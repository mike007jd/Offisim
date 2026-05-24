import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@offisim/ui-core';

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

const WORKSPACE_MIN_HEIGHT_CLASS: Record<string, string> = {
  office: 'min-h-0',
  personnel: 'min-h-0',
  sops: 'min-h-0',
  market: 'min-h-0',
  'activity-log': 'min-h-0',
  settings: 'min-h-0',
};

const WORKSPACE_SHELL_CLASS = 'flex h-full min-h-0 flex-col overflow-hidden pointer-events-auto';

const WORKSPACE_HEADER_CLASS =
  'border-b border-line px-sp-6 py-sp-5 max-xl:px-sp-5 max-xl:py-sp-4 max-md:px-sp-4 max-md:py-sp-3';

const WORKSPACE_EYEBROW_CLASS =
  'text-fs-micro font-semibold uppercase leading-none tracking-ls-caps text-ink-3';

const WORKSPACE_TITLE_CLASS =
  'mt-sp-1 text-fs-xl max-md:text-fs-lg font-semibold leading-tight text-ink-1';

function workspaceMinHeightClass(workspace?: string) {
  return workspace ? (WORKSPACE_MIN_HEIGHT_CLASS[workspace] ?? 'min-h-0') : 'min-h-0';
}

function LoadingSkeleton({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div data-testid="workspace-loading-skeleton">
      <header className={WORKSPACE_HEADER_CLASS}>
        <p className={WORKSPACE_EYEBROW_CLASS}>{eyebrow}</p>
        <h1 className={WORKSPACE_TITLE_CLASS}>{title}</h1>
      </header>
      <div className="flex min-h-0 flex-col gap-4 px-sp-6 py-sp-6">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
        <div className="h-32 w-full animate-pulse rounded-r-md bg-surface-2" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
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
      <AlertCircle className="h-8 w-8 text-danger" />
      <p className="max-w-md text-sm text-danger">{message}</p>
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
      className={cn(WORKSPACE_SHELL_CLASS, className)}
      data-testid={testId}
      data-workspace={workspace}
    >
      {topSlot}

      {loading ? (
        <LoadingSkeleton eyebrow={eyebrow} title={title} />
      ) : (
        <>
          <header className={WORKSPACE_HEADER_CLASS}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={WORKSPACE_EYEBROW_CLASS}>{eyebrow}</p>
                <h1 className={WORKSPACE_TITLE_CLASS}>{title}</h1>
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
            <div
              className={cn('min-h-0 flex-1 overflow-hidden', workspaceMinHeightClass(workspace))}
            >
              {children}
            </div>
          )}
        </>
      )}
    </div>
  );
}
