import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useCompanies, useProjects } from '@/data/queries.js';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Input } from '@/design-system/primitives/input.js';
import { pickWorkspaceFolder } from '@/lib/desktop-dialog.js';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FolderGit2, FolderOpen, Pencil, Plus } from 'lucide-react';
import { type CSSProperties, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

function trimToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function companyBadgeStyle(company: { accentA: string; accentB: string }): CSSProperties {
  return {
    '--off-scope-badge-a': company.accentA,
    '--off-scope-badge-b': company.accentB,
  } as CSSProperties;
}

function ProjectDialog({
  open,
  onOpenChange,
  mode,
  companyId,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'new' | 'edit';
  companyId: string | null;
  project: Project | null;
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
        await repos.projects.update(project.id, {
          name: cleanName,
          workspace_root: trimToNull(workspaceRoot),
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
          workspace_root: trimToNull(workspaceRoot),
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
      if (folder) setWorkspaceRoot(folder);
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
            Project metadata is persisted through the Offisim desktop repository.
          </DialogDescription>
        </DialogHeader>
        <div className="off-field">
          <label className="off-field-label" htmlFor={nameId}>
            Name
          </label>
          <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="off-field">
          <label className="off-field-label" htmlFor={workspaceRootId}>
            Workspace folder
          </label>
          <div className="off-inline-field">
            <Input
              id={workspaceRootId}
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
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
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScopeBar() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setCompany = useUiState((s) => s.setCompany);
  const setProject = useUiState((s) => s.setProject);
  const setSurface = useUiState((s) => s.setSurface);

  const companies = useCompanies();
  const projects = useProjects(companyId);
  const [projectDialog, setProjectDialog] = useState<'new' | 'edit' | null>(null);

  const activeCompany = companies.data?.find((c) => c.id === companyId);
  const activeProject = projects.data?.find((p) => p.id === projectId);

  async function openProjectFolder() {
    if (!activeProject?.workspaceRoot) {
      toast.error('No workspace folder is bound');
      return;
    }
    if (!('__TAURI_INTERNALS__' in window)) {
      toast.error('Open folder requires the desktop runtime');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_local_path', { projectId: activeProject.id, path: '.' });
      toast.success('Opened project folder');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Open folder failed');
    }
  }

  return (
    <div className="off-scope-bar">
      <DropdownMenu>
        <DropdownMenuTrigger className="off-scope-seg off-focusable" aria-label="Switch company">
          {activeCompany ? (
            <span className="off-scope-badge" style={companyBadgeStyle(activeCompany)}>
              {activeCompany.initials}
            </span>
          ) : null}
          <span className="off-scope-name">{activeCompany?.name ?? 'Select company'}</span>
          <Icon icon={ChevronDown} size="sm" className="off-scope-caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Companies</DropdownMenuLabel>
          {companies.data?.map((company) => (
            <DropdownMenuItem key={company.id} onSelect={() => setCompany(company.id)}>
              <span className="off-scope-badge" style={companyBadgeStyle(company)}>
                {company.initials}
              </span>
              <span className="grow">{company.name}</span>
              {company.id === companyId ? (
                <Icon icon={Check} size="sm" className="off-scope-check" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSurface('lifecycle')}>
            <Icon icon={Plus} size="sm" />
            New company
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="off-scope-divider" aria-hidden>
        /
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger className="off-scope-seg off-focusable" aria-label="Switch project">
          <Icon icon={FolderGit2} size="sm" className="off-scope-caret" />
          <span className="off-scope-name">{activeProject?.name ?? 'No project'}</span>
          <Icon icon={ChevronDown} size="sm" className="off-scope-caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.data?.length ? (
            projects.data.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => setProject(project.id)}>
                <Icon icon={FolderGit2} size="sm" />
                <span className="grow">{project.name}</span>
                {project.id === projectId ? (
                  <Icon icon={Check} size="sm" className="off-scope-check" />
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No projects in this company</DropdownMenuItem>
          )}
          {activeProject ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!activeProject.workspaceRoot}
                title={
                  activeProject.workspaceRoot
                    ? 'Open the bound project workspace folder'
                    : 'Bind a workspace folder before opening it'
                }
                onSelect={() => void openProjectFolder()}
              >
                <Icon icon={FolderOpen} size="sm" />
                Open folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setProjectDialog('edit')}>
                <Icon icon={Pencil} size="sm" />
                Edit project
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProjectDialog('new')}>
            <Icon icon={Plus} size="sm" />
            New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectDialog
        open={projectDialog !== null}
        onOpenChange={(open) => setProjectDialog(open ? (projectDialog ?? 'new') : null)}
        mode={projectDialog ?? 'new'}
        companyId={companyId}
        project={activeProject ?? null}
      />
    </div>
  );
}
