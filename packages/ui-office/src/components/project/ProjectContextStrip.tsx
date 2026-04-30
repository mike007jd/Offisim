import { type ProjectRow, formatWorkspaceRootHint } from '@offisim/shared-types';
import { ExternalLink, FolderOpen, Pencil } from 'lucide-react';
import { useState } from 'react';
import { isFolderPickerAvailable, revealWorkspaceFolder } from '../../lib/folder-picker.js';

export interface ProjectContextStripProps {
  activeProject: ProjectRow | null;
  onRequestEdit: (project: ProjectRow) => void;
  /** Toast surface for "Folder not found" failures. */
  onError?: (message: string) => void;
}

/**
 * Project context strip — rendered above ChatPanel's tab strip when a project
 * is active. Stays invisible (zero rendered DOM) when activeProject is null.
 */
export function ProjectContextStrip({
  activeProject,
  onRequestEdit,
  onError,
}: ProjectContextStripProps) {
  const [opening, setOpening] = useState(false);
  if (!activeProject) return null;

  const desktopMode = isFolderPickerAvailable();
  const folder = activeProject.workspace_root;
  const hint = formatWorkspaceRootHint(folder);
  const canOpenFolder = desktopMode && !!folder;

  async function handleOpenFolder() {
    if (!canOpenFolder || !folder || opening) return;
    setOpening(true);
    try {
      await revealWorkspaceFolder(folder);
    } catch {
      onError?.(`Folder not found at ${folder}. Edit project to rebind.`);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-muted px-3 py-1.5 text-xs text-text-secondary">
      <span className="text-text-muted">Project</span>
      <span className="text-text-muted">·</span>
      <span
        className="max-w-[160px] truncate font-medium text-text-primary"
        title={activeProject.name}
      >
        {activeProject.name}
      </span>
      <span className="text-text-muted">·</span>
      <span
        className={`max-w-[280px] truncate ${folder ? 'text-text-secondary' : 'text-text-muted'}`}
        title={folder ?? 'No folder bound'}
      >
        {hint}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {canOpenFolder && (
          <button
            type="button"
            onClick={handleOpenFolder}
            disabled={opening}
            className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            title="Open in OS file manager"
          >
            <FolderOpen className="h-3 w-3" />
            Open folder
            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onRequestEdit(activeProject)}
          className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          title="Edit project"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      </div>
    </div>
  );
}
