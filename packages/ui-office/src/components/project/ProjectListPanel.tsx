import { type ProjectRow, formatWorkspaceRootHint } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { ExternalLink, FolderOpen, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isFolderPickerAvailable, revealWorkspaceFolder } from '../../lib/folder-picker.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
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
  const { repos } = useOffisimRuntimeServices();
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
    <div className="project-selected-summary">
      <div className="project-selected-summary-row">
        <span data-slot="label">Project</span>
        <span data-slot="value">{project.name}</span>
      </div>
      <div className="project-selected-summary-stack">
        <span data-slot="label">Workspace folder</span>
        <span
          data-state={project.workspace_root ? 'bound' : 'empty'}
          title={project.workspace_root ?? undefined}
        >
          {formatWorkspaceRootHint(project.workspace_root)}
        </span>
      </div>
      <div className="project-selected-summary-meta">
        <span>
          <span data-slot="value">{threadCount ?? '—'}</span> threads
        </span>
      </div>
      {(canOpenFolder || onRequestEdit) && (
        <div className="project-selected-summary-actions">
          {canOpenFolder && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenFolder}
              disabled={openingFolder}
              className="project-selected-summary-action"
            >
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              Open
              <ExternalLink data-icon="inline-end" aria-hidden="true" />
            </Button>
          )}
          {onRequestEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRequestEdit(project)}
              className="project-selected-summary-action"
            >
              <Pencil data-icon="inline-start" aria-hidden="true" />
              Edit
            </Button>
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
