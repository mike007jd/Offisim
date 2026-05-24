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
  const workspaceRequired = false;
  const canSubmit = trimmedName.length > 0 && !submitting;

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
        className="project-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="project-dialog-field">
          <label htmlFor="project-create-name">Name</label>
          <Input
            id="project-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme onboarding"
          />
        </div>

        <div className="project-dialog-field">
          <label htmlFor="project-create-description">
            Description <span>(optional)</span>
          </label>
          <Textarea
            id="project-create-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
            rows={3}
          />
        </div>

        <div className="project-dialog-field">
          <span data-slot="label">
            Workspace folder {workspaceRequired && <span data-state="required">(required)</span>}
          </span>
          {desktopMode ? (
            <div className="project-dialog-folder">
              <div>
                <div className="project-dialog-folder-input">
                  <Folder data-icon="folder" aria-hidden="true" />
                  <Input
                    aria-label="Workspace folder path"
                    className="project-dialog-path-input"
                    value={workspaceRoot ?? ''}
                    onChange={(e) => setWorkspaceRoot(trimToNull(e.target.value))}
                    placeholder="Paste local workspace path"
                    title={workspaceRoot ?? undefined}
                    disabled={picking || submitting}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleChooseFolder}
                  disabled={picking || submitting}
                  className="project-dialog-folder-action"
                >
                  <FolderSearch data-icon="inline-start" aria-hidden="true" />
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
                    className="project-dialog-folder-action"
                  >
                    <X data-icon="inline-start" aria-hidden="true" />
                    Clear
                  </Button>
                )}
              </div>
              {workspaceRequired && !workspaceRoot && (
                <p data-state="error">Choose a workspace folder before creating this project.</p>
              )}
            </div>
          ) : (
            <div className="project-dialog-folder-unavailable">
              <Folder data-icon="folder" aria-hidden="true" />
              Folder binding is desktop-only.
            </div>
          )}
        </div>

        {error && <p className="project-dialog-error">{error}</p>}

        {/* Hidden submit so Enter triggers the form. The footer button does the same. */}
        <Button
          type="submit"
          className="project-dialog-hidden-submit"
          aria-hidden="true"
          tabIndex={-1}
        />
      </form>
    </DialogShell>
  );
}
