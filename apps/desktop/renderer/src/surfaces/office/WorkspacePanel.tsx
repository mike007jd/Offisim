import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { initGitRepository } from '@/data/git-workbench.js';
import { useGitWorkbench, useProjects } from '@/data/queries.js';
import type { Project } from '@/data/types.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { pickWorkspaceFolder } from '@/lib/desktop-dialog.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { useQueryClient } from '@tanstack/react-query';
import { FolderClosed, FolderGit2, GitBranch, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ProjectDialog } from './ProjectDialog.js';
import { FilesTab } from './workspace-panel/FilesTab.js';
import { GitTab } from './workspace-panel/GitTab.js';
import { compactPath, ProjectsTab } from './workspace-panel/ProjectsTab.js';

type PanelTab = 'projects' | 'files' | 'git';

function resolveWorkspacePanelTab(
  activeProjectId: string | null | undefined,
  requestedTab: PanelTab,
): PanelTab {
  return activeProjectId?.trim() ? requestedTab : 'projects';
}

export function WorkspacePanel() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setProject = useUiState((s) => s.setProject);
  const queryClient = useQueryClient();
  const projects = useProjects(companyId);
  const project = projects.data?.find((p) => p.id === projectId);
  const activeProjectId = project?.id ?? null;
  const git = useGitWorkbench(activeProjectId);
  const [requestedTab, setTab] = useState<PanelTab>('files');
  const tab = resolveWorkspacePanelTab(activeProjectId, requestedTab);
  const [bindingFolder, setBindingFolder] = useState(false);
  const [initializingRepo, setInitializingRepo] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{
    mode: 'new' | 'edit';
    project: Project | null;
  } | null>(null);

  const tabs = useMemo(
    () =>
      [
        { id: 'projects' as const, label: 'Projects' },
        { id: 'files' as const, label: 'Files' },
        { id: 'git' as const, label: 'Git' },
      ] satisfies Array<{ id: PanelTab; label: string }>,
    [],
  );

  async function bindWorkspaceFolder(targetProject = project) {
    if (!targetProject) {
      toast.error('Choose a Project first.');
      return;
    }
    setBindingFolder(true);
    try {
      const folder = await pickWorkspaceFolder('Choose Project folder');
      if (!folder) return;
      const repos = await reposOrNull();
      if (!repos) {
        toast.error('Project binding requires the desktop runtime');
        return;
      }
      const existing = await repos.projects.findById(targetProject.id);
      if (!existing) throw new Error('Project was not found');
      await invokeCommand('project_update', {
        input: {
          projectId: existing.project_id,
          name: existing.name,
          description: existing.description,
          status: existing.status,
          workspaceSelectionRef: folder.selectionRef,
          verifyCommand: existing.verify_command,
          verifyMaxAttempts: existing.verify_max_attempts,
          verifyTokenBudget: existing.verify_token_budget,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['project-files', targetProject.id] }),
        queryClient.invalidateQueries({ queryKey: ['git-workbench', targetProject.id] }),
      ]);
      setProject(targetProject.id);
      setTab('files');
      toast.success('Project folder updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Workspace binding failed');
    } finally {
      setBindingFolder(false);
    }
  }

  async function initializeRepository() {
    if (initializingRepo) return;
    if (!project) {
      toast.error('Select a project before initializing a repository');
      return;
    }
    setInitializingRepo(true);
    try {
      await initGitRepository(project.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['git-workbench', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['project-files', project.id] }),
      ]);
      setTab('git');
      toast.success('Initialized an empty git repository');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'git init failed');
    } finally {
      setInitializingRepo(false);
    }
  }

  async function rescanWorkspace() {
    if (!project) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-files', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['git-workbench', project.id] }),
    ]);
    toast.success('Workspace refreshed');
  }

  function selectProject(nextProject: Project) {
    setProject(nextProject.id);
    setTab(nextProject.workspaceRoot ? 'files' : 'projects');
  }

  function refreshPanel() {
    if (tab === 'projects') {
      void projects.refetch();
      return;
    }
    void rescanWorkspace();
  }

  return (
    <aside id="office-workspace-panel" className="off-ws-panel" aria-label="Workspace panel">
      <div className="off-ws-head">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const nextTab = value as PanelTab;
            if (nextTab !== 'projects' && !project) return;
            setTab(nextTab);
          }}
        >
          <TabsList className="off-ws-tabs" aria-label="Workspace panel">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                disabled={t.id !== 'projects' && !project}
                className={cn('off-ws-tab off-focusable', tab === t.id && 'is-active')}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto">
          <IconButton
            icon={RefreshCw}
            label={tab === 'projects' ? 'Refresh projects' : 'Rescan workspace'}
            size="iconSm"
            onClick={refreshPanel}
            disabled={tab !== 'projects' && (!project?.workspaceRoot || bindingFolder)}
          />
        </div>
      </div>

      {tab === 'projects' ? (
        <ProjectsTab
          projects={projects.data ?? []}
          activeProjectId={projectId}
          isLoading={projects.isLoading}
          error={projects.error}
          bindingFolder={bindingFolder}
          onRetry={() => void projects.refetch()}
          onSelect={selectProject}
          onNew={() => setProjectDialog({ mode: 'new', project: null })}
          onEdit={(nextProject) => setProjectDialog({ mode: 'edit', project: nextProject })}
          onBindFolder={(nextProject) => void bindWorkspaceFolder(nextProject)}
        />
      ) : !project ? (
        <EmptyState
          icon={FolderGit2}
          title="No active project"
          description="Create a Project and choose where its files live."
          action={{
            label: 'New project',
            onClick: () => setProjectDialog({ mode: 'new', project: null }),
          }}
        />
      ) : tab === 'files' ? (
        <FilesTab
          projectId={project.id}
          workspaceRoot={project.workspaceRoot}
          onBindFolder={() => void bindWorkspaceFolder()}
        />
      ) : git.isLoading ? (
        <SkeletonRows rows={6} />
      ) : git.isError ? (
        <ErrorState
          title="Git workbench unavailable"
          detail={git.error?.message ?? 'Git workbench failed to load.'}
          onRetry={() => void git.refetch()}
        />
      ) : git.data?.status === 'repo' ? (
        <GitTab
          key={project.id}
          workbench={git.data.workbench}
          companyId={companyId}
          projectId={project.id}
        />
      ) : git.data?.status === 'uninitialized' ? (
        // Valid folder, just not a git repo yet → Initialize is the primary
        // action; Change folder is only for a mistaken selection.
        <EmptyState
          icon={GitBranch}
          title="Not a git repository yet"
          description="Initialize a repository here to track changes, review diffs, and let runs commit work."
          action={{
            label: initializingRepo ? 'Initializing…' : 'Initialize repository',
            onClick: () => void initializeRepository(),
          }}
          secondaryAction={{ label: 'Change folder', onClick: () => void bindWorkspaceFolder() }}
          detail={`${compactPath(project?.workspaceRoot)} · no git repository`}
        />
      ) : git.data?.status === 'invalid-folder' ? (
        // The selected Project folder can no longer be resolved (moved/deleted).
        <EmptyState
          icon={FolderClosed}
          title="Project folder not found"
          description="The Project folder was moved, deleted, or can no longer be read. Choose a different folder."
          action={{ label: 'Change folder', onClick: () => void bindWorkspaceFolder() }}
          detail={`${compactPath(project?.workspaceRoot)} · not found`}
        />
      ) : (
        // Project has no chosen folder. Same task as the Files empty state.
        <EmptyState
          icon={FolderClosed}
          title="No Project folder"
          description="Choose the folder that contains this Project’s files."
          action={{ label: 'Choose folder', onClick: () => void bindWorkspaceFolder() }}
        />
      )}
      <ProjectDialog
        open={projectDialog !== null}
        onOpenChange={(open) => {
          if (!open) setProjectDialog(null);
        }}
        mode={projectDialog?.mode ?? 'new'}
        companyId={companyId || null}
        project={projectDialog?.project ?? null}
        onSaved={(savedProjectId) => {
          setProject(savedProjectId);
          setTab('files');
        }}
      />
    </aside>
  );
}
