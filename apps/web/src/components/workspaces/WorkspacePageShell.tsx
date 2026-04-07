import { AlertCircle } from 'lucide-react';
import type { WorkspacePageShellProps } from './types';

// ---------------------------------------------------------------------------
// Loading skeleton — shown while workspace data is loading
// ---------------------------------------------------------------------------

function LoadingSkeleton({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div data-testid="workspace-loading-skeleton">
      <header className="workspace-shell-header">
        <p className="workspace-shell-eyebrow">{eyebrow}</p>
        <h1 className="workspace-shell-title">{title}</h1>
      </header>
      <div className="px-6 py-6 space-y-4">
        <div className="h-4 w-3/4 rounded bg-white/5 animate-pulse" />
        <div className="h-4 w-1/2 rounded bg-white/5 animate-pulse" />
        <div className="h-32 w-full rounded-lg bg-white/5 animate-pulse" />
        <div className="h-4 w-2/3 rounded bg-white/5 animate-pulse" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state — shown when data loading fails
// ---------------------------------------------------------------------------

function ErrorState({ message }: { message: string }) {
  return (
    <div
      data-testid="workspace-error"
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <AlertCircle className="h-8 w-8 text-red-400/80" />
      <p className="text-sm text-red-300/90 max-w-md">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspacePageShell
// ---------------------------------------------------------------------------

/**
 * Shared page shell for non-office workspaces (SOPs, Market, Activity Log).
 *
 * Renders a consistent page header with eyebrow, title, and optional actions.
 * Handles loading, error, and empty states uniformly. Provides responsive
 * layout contracts via CSS for desktop / tablet / narrow tiers.
 *
 * This replaces the old `WorkspaceSurface` card-overlay pattern — the shell
 * renders as a real page surface, not a floating card on top of the Office.
 */
export function WorkspacePageShell({
  eyebrow,
  title,
  actions,
  loading,
  error,
  empty,
  children,
}: WorkspacePageShellProps) {
  // Loading state — skeleton with eyebrow + title visible
  if (loading) {
    return (
      <div className="workspace-shell" data-testid="workspace-page-shell">
        <LoadingSkeleton eyebrow={eyebrow} title={title} />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="workspace-shell" data-testid="workspace-page-shell">
        <header className="workspace-shell-header">
          <p className="workspace-shell-eyebrow">{eyebrow}</p>
          <h1 className="workspace-shell-title">{title}</h1>
        </header>
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="workspace-shell" data-testid="workspace-page-shell">
      <header className="workspace-shell-header">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="workspace-shell-eyebrow">{eyebrow}</p>
            <h1 className="workspace-shell-title">{title}</h1>
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </div>
      </header>

      {/* Empty state — rendered when `empty` prop is provided */}
      {empty ? (
        <div data-testid="workspace-empty" className="flex-1 min-h-0">
          {empty}
        </div>
      ) : (
        <div className="workspace-shell-content">{children}</div>
      )}
    </div>
  );
}
