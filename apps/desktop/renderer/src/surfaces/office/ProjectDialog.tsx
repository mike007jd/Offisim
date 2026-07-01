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
  const [name, setName] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(mode === 'edit' ? (project?.name ?? '') : '');
    setWorkspaceRoot(mode === 'edit' ? (project?.workspaceRoot ?? '') : '');
  }, [mode, open, project]);

  async function save() {
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('Project name is required');
      return;
    }
    const cleanWorkspaceRoot = trimToNull(workspaceRoot);
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
              ? 'Update the name or workspace folder.'
              : 'Name it and pick a workspace folder.'}
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
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
