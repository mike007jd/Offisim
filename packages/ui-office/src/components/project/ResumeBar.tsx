interface ResumeBarProject {
  threadId: string;
  projectName: string;
}

interface ResumeBarProps {
  projects: ReadonlyArray<ResumeBarProject>;
  onResume: (threadId: string) => void;
  onDismiss: () => void;
}

/**
 * ResumeBar — a top banner shown when threads were left in 'running' status on
 * last session (app crashed or closed mid-execution). Gives the user a one-click
 * way to resume or dismiss the detected unfinished work.
 */
export function ResumeBar({ projects, onResume, onDismiss }: ResumeBarProps) {
  if (projects.length === 0) return null;

  return (
    <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-2 text-sm">
      <span className="text-amber-200 shrink-0">
        {projects.length === 1 ? '1 unfinished project' : `${projects.length} unfinished projects`}
      </span>
      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
        {projects.map((p) => (
          <button
            key={p.threadId}
            type="button"
            onClick={() => onResume(p.threadId)}
            className="px-2.5 py-1.5 bg-amber-700/50 hover:bg-amber-600/50 rounded text-xs text-amber-100 truncate max-w-[200px]"
            title={p.projectName}
          >
            Resume {p.projectName}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto text-amber-400/60 hover:text-amber-300 text-xs shrink-0"
        aria-label="Dismiss unfinished project notice"
      >
        Dismiss
      </button>
    </div>
  );
}
