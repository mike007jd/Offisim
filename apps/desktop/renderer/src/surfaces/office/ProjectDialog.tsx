import { reposOrNull } from '@/data/adapters.js';
import type { Project } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { pickWorkspaceFolder } from '@/lib/desktop-dialog.js';
import { type ProjectWorkspaceSelectionClaim, invokeCommand } from '@/lib/tauri-commands.js';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

function trimToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ProjectDialog({
  open,
  onOpenChange,
  mode,
  companyId,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'new' | 'edit';
  companyId: string | null;
  project: Project | null;
  onSaved?: (projectId: string) => void;
}) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const workspaceRootId = useId();
  const workspaceRootHintId = useId();
  const verifyCommandId = useId();
  const verifyAttemptsId = useId();
  const verifyTokenBudgetId = useId();
  const [name, setName] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workspaceSelection, setWorkspaceSelection] =
    useState<ProjectWorkspaceSelectionClaim | null>(null);
  const [verifyCommand, setVerifyCommand] = useState('');
  const [verifyMaxAttempts, setVerifyMaxAttempts] = useState('3');
  const [verifyTokenBudget, setVerifyTokenBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const canSave = Boolean(name.trim() && workspaceRoot.trim()) && !saving;

  useEffect(() => {
    if (!open) return;
    setName(mode === 'edit' ? (project?.name ?? '') : '');
    setWorkspaceRoot(mode === 'edit' ? (project?.workspaceRoot ?? '') : '');
    setWorkspaceSelection(null);
    setVerifyCommand(mode === 'edit' ? (project?.verifyCommand ?? '') : '');
    setVerifyMaxAttempts(String(mode === 'edit' ? (project?.verifyMaxAttempts ?? 3) : 3));
    setVerifyTokenBudget(
      mode === 'edit' && project?.verifyTokenBudget ? String(project.verifyTokenBudget) : '',
    );
  }, [mode, open, project]);

  async function save() {
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('Project name is required');
      return;
    }
    const requestedWorkspaceRoot = workspaceRoot.trim();
    if (!requestedWorkspaceRoot) {
      toast.error('Project folder is required');
      return;
    }
    const cleanVerifyCommand = trimToNull(verifyCommand);
    const verifyEnabled = cleanVerifyCommand !== null;
    const cleanVerifyMaxAttempts = verifyEnabled ? Number.parseInt(verifyMaxAttempts, 10) : 3;
    const cleanVerifyTokenBudget =
      verifyEnabled && verifyTokenBudget.trim() ? Number.parseInt(verifyTokenBudget, 10) : null;
    if (
      verifyEnabled &&
      (!Number.isInteger(cleanVerifyMaxAttempts) ||
        cleanVerifyMaxAttempts < 1 ||
        cleanVerifyMaxAttempts > 20)
    ) {
      toast.error('Verify attempts must be between 1 and 20');
      return;
    }
    if (
      verifyEnabled &&
      cleanVerifyTokenBudget !== null &&
      (!Number.isInteger(cleanVerifyTokenBudget) || cleanVerifyTokenBudget < 1)
    ) {
      toast.error('Verify token budget must be a positive whole number');
      return;
    }
    setSaving(true);
    try {
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('Project editing requires the desktop runtime');
      }
      if (!companyId) {
        throw new Error('Select or create a company before editing projects');
      }
      let savedProjectId = project?.id ?? null;
      if (mode === 'edit' && project) {
        const existing = await repos.projects.findById(project.id);
        if (!existing) throw new Error('Project was not found');
        await invokeCommand('project_update', {
          input: {
            projectId: project.id,
            name: cleanName,
            description: existing.description,
            status: existing.status,
            workspaceSelectionRef: workspaceSelection?.selectionRef ?? null,
            verifyCommand: cleanVerifyCommand,
            verifyMaxAttempts: cleanVerifyMaxAttempts,
            verifyTokenBudget: cleanVerifyTokenBudget,
          },
        });
        toast.success('Project updated');
      } else {
        if (!workspaceSelection) {
          throw new Error('Choose the Project folder before creating this Project');
        }
        savedProjectId = crypto.randomUUID();
        await invokeCommand('project_create', {
          input: {
            projectId: savedProjectId,
            companyId,
            name: cleanName,
            description: null,
            status: 'planning',
            workspaceSelectionRef: workspaceSelection.selectionRef,
            verifyCommand: cleanVerifyCommand,
            verifyMaxAttempts: cleanVerifyMaxAttempts,
            verifyTokenBudget: cleanVerifyTokenBudget,
          },
        });
        toast.success('Project created');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', companyId] }),
        savedProjectId
          ? queryClient.invalidateQueries({ queryKey: ['project-files', savedProjectId] })
          : Promise.resolve(),
        savedProjectId
          ? queryClient.invalidateQueries({ queryKey: ['git-workbench', savedProjectId] })
          : Promise.resolve(),
      ]);
      if (savedProjectId) onSaved?.(savedProjectId);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Project save failed');
    } finally {
      setSaving(false);
    }
  }

  async function chooseWorkspaceFolder() {
    try {
      const folder = await pickWorkspaceFolder('Choose Project folder');
      if (!folder) return;
      setWorkspaceRoot(folder.displayPath);
      setWorkspaceSelection(folder);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Folder picker failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit project' : 'New project'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update the Project name, folder, and optional verification command.'
              : 'Choose the folder where this Project’s files live.'}
          </DialogDescription>
        </DialogHeader>
        <div className="off-field">
          <label className="off-field-label" htmlFor={nameId}>
            Name
          </label>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="off-field">
          <label className="off-field-label" htmlFor={workspaceRootId}>
            Project folder <span aria-hidden="true">*</span>
          </label>
          <div className="off-inline-field">
            <Input
              id={workspaceRootId}
              value={workspaceRoot}
              readOnly
              placeholder="Choose a folder"
              aria-describedby={workspaceRootHintId}
              required
            />
            <Button type="button" variant="outline" onClick={() => void chooseWorkspaceFolder()}>
              <Icon icon={FolderOpen} size="sm" />
              {workspaceRoot ? 'Change' : 'Choose'}
            </Button>
          </div>
          <p id={workspaceRootHintId} className="off-field-hint">
            Required. Every Project keeps its files in one folder.
          </p>
        </div>
        <div className="off-field">
          <label className="off-field-label" htmlFor={verifyCommandId}>
            Verify command <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            id={verifyCommandId}
            value={verifyCommand}
            onChange={(event) => setVerifyCommand(event.target.value)}
            placeholder="Not configured"
          />
          <p className="off-field-hint">
            Leave empty to run once. When set, write tasks retry until this command passes or a
            limit is reached.
          </p>
        </div>
        {verifyCommand.trim() ? (
          <div className="grid grid-cols-2 gap-[var(--off-sp-3)]">
            <div className="off-field">
              <label className="off-field-label" htmlFor={verifyAttemptsId}>
                Maximum attempts
              </label>
              <Input
                id={verifyAttemptsId}
                type="number"
                min={1}
                max={20}
                value={verifyMaxAttempts}
                onChange={(event) => setVerifyMaxAttempts(event.target.value)}
              />
            </div>
            <div className="off-field">
              <label className="off-field-label" htmlFor={verifyTokenBudgetId}>
                Token budget
              </label>
              <Input
                id={verifyTokenBudgetId}
                type="number"
                min={1}
                value={verifyTokenBudget}
                onChange={(event) => setVerifyTokenBudget(event.target.value)}
                placeholder="Run budget"
              />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="off-project-save" onClick={save} disabled={!canSave}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
