import { type ProjectRow, formatWorkspaceRootHint } from '@offisim/shared-types';
import { ExternalLink, FolderOpen, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isFolderPickerAvailable, revealWorkspaceFolder } from '../../lib/folder-picker.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { ProjectWorkspaceFiles } from './ProjectWorkspaceFiles.js';

export function ProjectSelectedSummary({
  project,
  onRequestEdit,
  onError,
  showWorkspaceFiles = true,
}: {
  project: ProjectRow;
  onRequestEdit?: (project: ProjectRow) => void;
  onError?: (message: string) => void;
  showWorkspaceFiles?: boolean;
}) {
  const { repos } = useOffisimRuntime();
  const [threadCount, setThreadCount] = useState<number | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);
  const canOpenFolder = isFolderPickerAvailable() && Boolean(project.workspace_root);

  useEffect(() => {
    if (!repos?.chatThreads) {
      setThreadCount(null);
      return;
    }
    let cancelled = false;
    void repos.chatThreads.listByProject(project.project_id).then((rows) => {
      if (!cancelled) setThreadCount(rows.length);
    });
    return () => {
      cancelled = true;
    };
  }, [project.project_id, repos]);

  async function handleOpenFolder() {
    if (!project.workspace_root || openingFolder) return;
    setOpeningFolder(true);
    try {
      await revealWorkspaceFolder(project.workspace_root);
    } catch {
      onError?.(`Folder not found at ${project.workspace_root}. Edit project to rebind.`);
    } finally {
      setOpeningFolder(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-[11px] text-text-secondary">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary">Project</span>
        <span className="min-w-0 truncate text-right font-medium text-text-primary">
          {project.name}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary">
          Workspace folder
        </span>
        <span
          className={project.workspace_root ? 'text-text-primary' : 'text-text-secondary'}
          title={project.workspace_root ?? undefined}
        >
          {formatWorkspaceRootHint(project.workspace_root)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-text-secondary">
        <span>
          <span className="text-text-primary font-medium">{threadCount ?? '—'}</span> threads
        </span>
      </div>
      {(canOpenFolder || onRequestEdit) && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {canOpenFolder && (
            <button
              type="button"
              onClick={handleOpenFolder}
              disabled={openingFolder}
              className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-0.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <FolderOpen className="h-3 w-3" />
              Open
              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
          {onRequestEdit && (
            <button
              type="button"
              onClick={() => onRequestEdit(project)}
              className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-0.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>
      )}
      {showWorkspaceFiles ? (
        <ProjectWorkspaceFiles
          projectId={project.project_id}
          workspaceRoot={project.workspace_root}
        />
      ) : null}
    </div>
  );
}
