import { Button } from '@offisim/ui-core';

interface ResumeBarProject {
  threadId: string;
  projectName: string;
  status?: 'running' | 'blocked';
}

interface ResumeBarProps {
  projects: ReadonlyArray<ResumeBarProject>;
  onResume: (threadId: string) => void;
  onDismiss: () => void;
}

/**
 * ResumeBar — a top banner shown when threads were left running or blocked on
 * last session. Gives the user a one-click way to resume or dismiss work that
 * needs attention.
 */
export function ResumeBar({ projects, onResume, onDismiss }: ResumeBarProps) {
  if (projects.length === 0) return null;
  const blockedCount = projects.filter((project) => project.status === 'blocked').length;
  const runningCount = projects.length - blockedCount;
  const label =
    blockedCount > 0 && runningCount === 0
      ? blockedCount === 1
        ? '1 project needs review'
        : `${blockedCount} projects need review`
      : blockedCount > 0
        ? `${projects.length} projects need attention`
        : projects.length === 1
          ? '1 unfinished project'
          : `${projects.length} unfinished projects`;

  return (
    <div className="flex items-center gap-2 rounded-r-md border border-warn bg-warn-surface px-4 py-2 text-sm">
      <span className="shrink-0 text-warn">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {projects.map((p) => (
          <Button
            key={p.threadId}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onResume(p.threadId)}
            className="max-w-48 truncate border-warn bg-surface px-2.5 text-xs text-ink-1 hover:bg-surface-sunken"
            title={p.projectName}
          >
            {p.status === 'blocked' ? 'Review' : 'Resume'} {p.projectName}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        className="ml-auto shrink-0 text-xs text-warn hover:text-ink-1"
        aria-label="Dismiss unfinished project notice"
      >
        Dismiss
      </Button>
    </div>
  );
}
