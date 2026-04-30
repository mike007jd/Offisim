import { type ProjectRow, formatWorkspaceRootHint } from '@offisim/shared-types';
import { Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDeliverables } from '../../hooks/useDeliverables';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { ProjectWorkspaceFiles } from './ProjectWorkspaceFiles.js';

export function ProjectSelectedSummary({
  project,
  onRequestEdit,
}: {
  project: ProjectRow;
  onRequestEdit?: (project: ProjectRow) => void;
}) {
  const { repos } = useOffisimRuntime();
  const allDeliverables = useDeliverables();
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const threadId = project.thread_id;

  useEffect(() => {
    if (!threadId || !repos?.taskRuns) {
      setTaskCount(null);
      return;
    }
    let cancelled = false;
    void repos.taskRuns.findByThread(threadId).then((rows) => {
      if (!cancelled) setTaskCount(rows.length);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, repos]);

  const deliverableCount = useMemo(() => {
    if (!threadId) return 0;
    return allDeliverables.filter((d) => d.threadId === threadId).length;
  }, [allDeliverables, threadId]);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-[11px] text-text-secondary">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          Workspace folder
        </span>
        <span
          className={project.workspace_root ? 'text-text-primary' : 'text-text-muted'}
          title={project.workspace_root ?? undefined}
        >
          {formatWorkspaceRootHint(project.workspace_root)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-text-secondary">
        <span>
          <span className="text-text-primary font-medium">{taskCount ?? '—'}</span> tasks
        </span>
        <span>
          <span className="text-text-primary font-medium">{deliverableCount}</span> deliverables
        </span>
      </div>
      {onRequestEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onRequestEdit(project)}
            className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-0.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <Pencil className="h-3 w-3" />
            Edit project
          </button>
        </div>
      )}
      <ProjectWorkspaceFiles workspaceRoot={project.workspace_root} />
    </div>
  );
}
