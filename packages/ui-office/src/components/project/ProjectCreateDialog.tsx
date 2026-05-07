import { type ProjectRow, type ProjectUpdatePatch, trimToNull } from '@offisim/shared-types';
import { Button, DialogShell, Input, Textarea } from '@offisim/ui-core';
import { Folder, FolderSearch, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  FolderPickerUnavailableError,
  isFolderPickerAvailable,
  pickWorkspaceFolder,
} from '../../lib/folder-picker.js';

export interface ProjectCreateDialogCreateInput {
  name: string;
  description: string | null;
  workspaceRoot: string | null;
}

export interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: ProjectRow | null;
  /** Required in create mode. Resolves with the new project row. */
  onCreate?: (input: ProjectCreateDialogCreateInput) => Promise<ProjectRow>;
  /** Required in edit mode. Patch is a partial ProjectRow update. */
  onUpdate?: (projectId: string, patch: ProjectUpdatePatch) => Promise<void>;
  /** Called after a successful create with the new project (used to set it active). */
  onCreated?: (project: ProjectRow) => void;
  /** Called after a successful edit save. */
  onUpdated?: () => void;
}

/**
 * Single dialog for both project creation and editing. Edit mode pre-fills
 * the form from `initial`; submit calls `onUpdate(initial.project_id, patch)`
 * which writes through `repos.projects.update`.
 *
 * On desktop the workspace folder row exposes a Choose / Clear pair backed by
 * the Tauri dialog plugin. On web the row is a disabled hint reading
 * "Available on desktop" — `pickWorkspaceFolder` is never reached because the
 * Choose button is not rendered in browser mode.
 */
export function ProjectCreateDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onCreate,
  onUpdate,
  onCreated,
  onUpdated,
}: ProjectCreateDialogProps) {
  const desktopMode = isFolderPickerAvailable();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setPicking(false);
    if (mode === 'edit' && initial) {
      setName(initial.name);
      setDescription(initial.description ?? '');
      setWorkspaceRoot(initial.workspace_root ?? null);
    } else {
      setName('');
      setDescription('');
      setWorkspaceRoot(null);
    }
  }, [open, mode, initial]);

  const trimmedName = name.trim();
  const workspaceRequired = desktopMode && mode === 'create';
  const canSubmit =
    trimmedName.length > 0 && !submitting && (!workspaceRequired || !!workspaceRoot);

  async function handleChooseFolder() {
    if (!desktopMode || picking) return;
    setPicking(true);
    try {
      const picked = await pickWorkspaceFolder();
      if (picked) setWorkspaceRoot(picked);
    } catch (err) {
      if (!(err instanceof FolderPickerUnavailableError)) {
        setError(err instanceof Error ? err.message : 'Failed to open folder picker.');
      }
    } finally {
      setPicking(false);
    }
  }

  function handleClearFolder() {
    setWorkspaceRoot(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmedDescription = trimToNull(description);
      if (mode === 'create') {
        if (!onCreate) throw new Error('onCreate is required in create mode');
        const project = await onCreate({
          name: trimmedName,
          description: trimmedDescription,
          workspaceRoot,
        });
        onCreated?.(project);
        onOpenChange(false);
      } else {
        if (!initial || !onUpdate) throw new Error('onUpdate + initial are required in edit mode');
        const patch: ProjectUpdatePatch = {
          name: trimmedName,
          description: trimmedDescription,
          workspace_root: workspaceRoot,
        };
        await onUpdate(initial.project_id, patch);
        onUpdated?.();
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const title = mode === 'create' ? 'New project' : 'Edit project';
  const CTA_LABELS = {
    create: { idle: 'Create project', busy: 'Creating…' },
    edit: { idle: 'Save changes', busy: 'Saving…' },
  } as const;
  const ctaLabel = CTA_LABELS[mode][submitting ? 'busy' : 'idle'];

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      stackId="project-create"
      size="md"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {ctaLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="project-create-name" className="text-xs font-medium text-text-secondary">
            Name
          </label>
          <Input
            id="project-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme onboarding"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="project-create-description"
            className="text-xs font-medium text-text-secondary"
          >
            Description <span className="text-text-muted">(optional)</span>
          </label>
          <Textarea
            id="project-create-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
            rows={3}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">
            Workspace folder {workspaceRequired && <span className="text-error">(required)</span>}
          </span>
          {desktopMode ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary">
                  <Folder className="h-4 w-4 flex-shrink-0 text-info" />
                  {workspaceRoot ? (
                    <span className="truncate" title={workspaceRoot}>
                      {workspaceRoot}
                    </span>
                  ) : (
                    <span className={workspaceRequired ? 'text-error' : 'text-text-muted'}>
                      No folder bound
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleChooseFolder}
                  disabled={picking || submitting}
                >
                  <FolderSearch className="h-3.5 w-3.5" />
                  {picking ? 'Choosing…' : 'Choose'}
                </Button>
                {workspaceRoot && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFolder}
                    disabled={submitting}
                    aria-label="Clear folder"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
              </div>
              {workspaceRequired && !workspaceRoot && (
                <p className="text-xs text-error">
                  Choose a workspace folder before creating this project.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-muted px-3 py-2 text-xs text-text-muted">
              <Folder className="h-4 w-4 flex-shrink-0 opacity-60" />
              Folder binding is desktop-only.
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-error bg-error-muted px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        {/* Hidden submit so Enter triggers the form. The footer button does the same. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </DialogShell>
  );
}
