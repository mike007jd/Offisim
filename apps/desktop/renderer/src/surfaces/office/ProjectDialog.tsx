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
import { overbroadWorkspaceReason } from '@/lib/workspace-root-guard.js';
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
  const verifyCommandId = useId();
  const verifyAttemptsId = useId();
  const verifyTokenBudgetId = useId();
  const [name, setName] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [verifyCommand, setVerifyCommand] = useState('');
  const [verifyMaxAttempts, setVerifyMaxAttempts] = useState('3');
  const [verifyTokenBudget, setVerifyTokenBudget] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(mode === 'edit' ? (project?.name ?? '') : '');
    setWorkspaceRoot(mode === 'edit' ? (project?.workspaceRoot ?? '') : '');
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
    const cleanWorkspaceRoot = trimToNull(workspaceRoot);
    const cleanVerifyCommand = trimToNull(verifyCommand);
    const cleanVerifyMaxAttempts = Number.parseInt(verifyMaxAttempts, 10);
    const cleanVerifyTokenBudget = verifyTokenBudget.trim()
      ? Number.parseInt(verifyTokenBudget, 10)
      : null;
    if (
      !Number.isInteger(cleanVerifyMaxAttempts) ||
      cleanVerifyMaxAttempts < 1 ||
      cleanVerifyMaxAttempts > 20
    ) {
      toast.error('Verify attempts must be between 1 and 20');
      return;
    }
    if (
      cleanVerifyTokenBudget !== null &&
      (!Number.isInteger(cleanVerifyTokenBudget) || cleanVerifyTokenBudget < 1)
    ) {
      toast.error('Verify token budget must be a positive whole number');
      return;
    }
    setSaving(true);
    try {
      const overbroad = cleanWorkspaceRoot
        ? await overbroadWorkspaceReason(cleanWorkspaceRoot)
        : null;
      if (overbroad) {
        toast.error(overbroad);
        return;
      }
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('Project editing requires the desktop runtime');
      }
      if (!companyId) {
        throw new Error('Select or create a company before editing projects');
      }
      let savedProjectId = project?.id ?? null;
      if (mode === 'edit' && project) {
        await repos.projects.update(project.id, {
          name: cleanName,
          workspace_root: cleanWorkspaceRoot,
          verify_command: cleanVerifyCommand,
          verify_max_attempts: cleanVerifyMaxAttempts,
          verify_token_budget: cleanVerifyTokenBudget,
        });
        toast.success('Project updated');
      } else {
        savedProjectId = crypto.randomUUID();
        await repos.projects.create({
          project_id: savedProjectId,
          company_id: companyId,
          name: cleanName,
          description: null,
          status: 'planning',
          workspace_root: cleanWorkspaceRoot,
          verify_command: cleanVerifyCommand,
          verify_max_attempts: cleanVerifyMaxAttempts,
          verify_token_budget: cleanVerifyTokenBudget,
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
      const folder = await pickWorkspaceFolder('Select project workspace folder');
      if (!folder) return;
      const overbroad = await overbroadWorkspaceReason(folder);
      if (overbroad) {
        toast.error(overbroad);
        return;
      }
      setWorkspaceRoot(folder);
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
              ? 'Update the workspace and its delegated-work verification gate.'
              : 'Name it, bind its workspace, and optionally configure a verification gate.'}
          </DialogDescription>
        </DialogHeader>
        <div className="off-field">
          <label className="off-field-label" htmlFor={nameId}>
            Name
          </label>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="off-field">
          <label className="off-field-label" htmlFor={verifyCommandId}>
            Verify command
          </label>
          <Input
            id={verifyCommandId}
            value={verifyCommand}
            onChange={(event) => setVerifyCommand(event.target.value)}
            placeholder="Not configured"
          />
          <p className="off-field-hint">
            Leave empty for single-pass delegation. When configured, write tasks repeat until this
            command exits 0 or a limit is reached.
          </p>
        </div>
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
        <div className="off-field">
          <label className="off-field-label" htmlFor={workspaceRootId}>
            Workspace folder
          </label>
          <div className="off-inline-field">
            <Input
              id={workspaceRootId}
              value={workspaceRoot}
              onChange={(event) => setWorkspaceRoot(event.target.value)}
              placeholder="/Users/me/project"
            />
            <Button type="button" variant="outline" onClick={() => void chooseWorkspaceFolder()}>
              <Icon icon={FolderOpen} size="sm" />
              Choose
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="off-project-save" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
