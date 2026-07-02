import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import { useGitWorkbench, useProjectFiles, useProjects } from '@/data/queries.js';
import type { FileNode, GitFileChange, GitWorkbench, Project } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { pickWorkspaceFolder } from '@/lib/desktop-dialog.js';
import { cn } from '@/lib/utils.js';
import { overbroadWorkspaceReason } from '@/lib/workspace-root-guard.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  FileText,
  FolderClosed,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ProjectDialog } from './ProjectDialog.js';
import { openStageFilePreview } from './stage-viewer/file-preview.js';

type PanelTab = 'projects' | 'files' | 'git';
const FILE_PREVIEW_BYTES = 12_000;

interface FileContextMenuState {
  node: FileNode;
  x: number;
  y: number;
}

function compactPath(path: string | null | undefined) {
  if (!path) return 'No folder bound';
  return path.replace(/^\/Users\/[^/]+/u, '~');
}

const STATUS_GLYPH: Record<GitFileChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

function FilesTab({
  projectId,
  workspaceRoot,
  onBindFolder,
}: {
  projectId: string;
  workspaceRoot: string | null;
  onBindFolder: () => void;
}) {
  const openStageView = useUiState((s) => s.openStageView);
  const files = useProjectFiles(projectId);
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  if (!workspaceRoot) {
    return (
      <EmptyState
        icon={FolderClosed}
        title="No workspace bound"
        description="Bind a local folder to give this project file context for runs."
        action={{ label: 'Bind folder', onClick: onBindFolder }}
      />
    );
  }
  if (files.isLoading) return <SkeletonRows rows={6} />;

  const fileError = files.error;
  if (fileError) {
    return (
      <ErrorState
        title="Workspace files unavailable"
        detail={
          fileError instanceof Error
            ? fileError.message
            : typeof fileError === 'string'
              ? fileError
              : 'Project file listing failed.'
        }
        onRetry={() => void files.refetch()}
      />
    );
  }

  const visible = (files.data ?? []).filter((n) =>
    `${n.name} ${n.path}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function selectNode(node: FileNode) {
    setSelectedPath(node.path);
  }

  async function previewNode(node: FileNode) {
    setSelectedPath(node.path);
    if (node.kind === 'dir') {
      await revealNode(node);
      return;
    }
    await openStageFilePreview({
      path: node.path,
      openStageView,
      projectId,
      maxBytes: FILE_PREVIEW_BYTES,
    });
  }

  async function invokePathCommand(
    command: 'open_local_path' | 'reveal_local_path',
    node: FileNode,
  ) {
    if (!isTauriRuntime()) {
      toast.error('File actions require the desktop runtime');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke(command, { projectId, path: node.path });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Local path action failed',
      );
    }
  }

  async function openNode(node: FileNode) {
    await invokePathCommand('open_local_path', node);
  }

  async function revealNode(node: FileNode) {
    await invokePathCommand('reveal_local_path', node);
  }

  return (
    <>
      <div className="off-ws-toolbar">
        <span className="off-ws-wsroot" title={workspaceRoot}>
          <Icon icon={FolderOpen} size="sm" />
          {workspaceRoot}
        </span>
        <SearchInput value={query} onChange={setQuery} placeholder="Search files…" />
      </div>
      <div className="off-ws-scroll">
        <CapsLabel className="px-[var(--off-sp-3)] pb-[var(--off-sp-1)]">Files</CapsLabel>
        {visible.length > 0 ? (
          visible.map((node) => (
            <button
              type="button"
              key={node.path}
              className={cn(
                'off-tree-row off-focusable',
                selectedPath === node.path && 'is-active',
              )}
              data-depth={node.depth}
              aria-pressed={selectedPath === node.path}
              aria-haspopup="menu"
              onClick={() => selectNode(node)}
              onDoubleClick={() => void previewNode(node)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelectedPath(node.path);
                setContextMenu({ node, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void previewNode(node);
                }
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setContextMenu({
                    node,
                    x: rect.left + rect.width * 0.32,
                    y: rect.top + rect.height,
                  });
                }
              }}
            >
              <Icon
                icon={node.kind === 'dir' ? ChevronRight : FileText}
                size="sm"
                className="off-tree-icon"
              />
              {node.name}
            </button>
          ))
        ) : (
          <EmptyState
            icon={FileText}
            title={files.data?.length ? 'No matching files' : 'Workspace folder is empty'}
            description={
              files.data?.length
                ? 'Clear the search to return to the full project file list.'
                : 'Add files to the bound folder, then rescan the workspace.'
            }
            action={
              files.data?.length
                ? undefined
                : { label: 'Rescan', onClick: () => void files.refetch() }
            }
          />
        )}
        {contextMenu ? (
          <FileContextMenu
            state={contextMenu}
            onClose={() => setContextMenu(null)}
            onOpen={(node) => void openNode(node)}
            onPreview={(node) => void previewNode(node)}
            onReveal={(node) => void revealNode(node)}
          />
        ) : null}
      </div>
    </>
  );
}

function FileContextMenu({
  state,
  onClose,
  onOpen,
  onPreview,
  onReveal,
}: {
  state: FileContextMenuState;
  onClose: () => void;
  onOpen: (node: FileNode) => void;
  onPreview: (node: FileNode) => void;
  onReveal: (node: FileNode) => void;
}) {
  const style = {
    left: state.x,
    top: state.y,
  } as CSSProperties;

  return (
    <div
      className="off-file-context-menu"
      role="menu"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {state.node.kind === 'file' ? (
        <button
          type="button"
          role="menuitem"
          className="off-file-context-item off-focusable"
          onClick={() => {
            onPreview(state.node);
            onClose();
          }}
        >
          <Icon icon={FileText} size="sm" />
          Preview in Stage
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="off-file-context-item off-focusable"
        onClick={() => {
          onOpen(state.node);
          onClose();
        }}
      >
        <Icon icon={ExternalLink} size="sm" />
        Open in Default App
      </button>
      <button
        type="button"
        role="menuitem"
        className="off-file-context-item off-focusable"
        onClick={() => {
          onReveal(state.node);
          onClose();
        }}
      >
        <Icon icon={FolderOpen} size="sm" />
        Show in Finder
      </button>
    </div>
  );
}

function ProjectsTab({
  projects,
  activeProjectId,
  isLoading,
  error,
  bindingFolder,
  onRetry,
  onSelect,
  onNew,
  onEdit,
  onBindFolder,
}: {
  projects: Project[];
  activeProjectId: string;
  isLoading: boolean;
  error: unknown;
  bindingFolder: boolean;
  onRetry: () => void;
  onSelect: (project: Project) => void;
  onNew: () => void;
  onEdit: (project: Project) => void;
  onBindFolder: (project: Project) => void;
}) {
  if (isLoading) return <SkeletonRows rows={6} />;
  if (error) {
    return (
      <ErrorState
        title="Projects unavailable"
        detail={
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Project list failed to load.'
        }
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="off-ws-projects">
      <div className="off-ws-projects-actions">
        <button type="button" className="off-ws-project-new off-focusable" onClick={onNew}>
          <Icon icon={Plus} size="sm" />
          New project
        </button>
      </div>
      <div className="off-ws-scroll off-ws-project-scroll">
        <CapsLabel className="px-[var(--off-sp-3)] pb-[var(--off-sp-1)]">
          Projects · {projects.length}
        </CapsLabel>
        {projects.length > 0 ? (
          projects.map((project) => {
            const active = project.id === activeProjectId;
            return (
              <div key={project.id} className={cn('off-ws-project-row', active && 'is-active')}>
                <button
                  type="button"
                  className="off-ws-project-main off-focusable"
                  aria-pressed={active}
                  onClick={() => onSelect(project)}
                >
                  <Icon icon={FolderGit2} size="sm" />
                  <span className="off-ws-project-copy">
                    <span>{project.name}</span>
                    <small>{compactPath(project.workspaceRoot)}</small>
                  </span>
                  {active ? <Icon icon={Check} size="sm" className="off-ws-project-check" /> : null}
                </button>
                <div className="off-ws-project-row-actions">
                  <button
                    type="button"
                    className="off-ws-project-icon off-focusable"
                    onClick={() => onBindFolder(project)}
                    disabled={bindingFolder}
                    title="Choose workspace folder"
                  >
                    <Icon icon={FolderOpen} size="sm" />
                  </button>
                  <button
                    type="button"
                    className="off-ws-project-icon off-focusable"
                    onClick={() => onEdit(project)}
                    title="Edit project"
                  >
                    <Icon icon={Pencil} size="sm" />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Create a project and bind a local folder before starting project work."
            action={{ label: 'New project', onClick: onNew }}
          />
        )}
      </div>
    </div>
  );
}

function GitTab({ workbench }: { workbench: GitWorkbench }) {
  const openStageView = useUiState((s) => s.openStageView);
  return (
    <div className="off-gw">
      <div className="off-gw-branch">
        <Icon icon={GitBranch} size="sm" />
        <span className="off-gw-branch-name">{workbench.branch}</span>
        <span className="off-gw-counts">
          ↑{workbench.ahead} ↓{workbench.behind}
        </span>
      </div>

      <div className="off-gw-section">
        <CapsLabel>Changes · {workbench.changes.length}</CapsLabel>
        <div className="off-gw-files">
          {workbench.changes.map((change) => (
            <button
              key={change.path}
              type="button"
              className="off-gw-file off-focusable"
              onClick={() => openStageView({ kind: 'changes', path: change.path })}
            >
              <span className={cn('off-gw-status', `is-${change.status}`)}>
                {STATUS_GLYPH[change.status]}
              </span>
              {change.staged ? <span className="off-gw-stage">staged</span> : null}
              <span className="off-gw-path">{change.path}</span>
              <span className="off-gw-stat">
                <span className="off-gw-add">+{change.added}</span>
                <span className="off-gw-rem">−{change.removed}</span>
              </span>
            </button>
          ))}
          {workbench.changes.length === 0 ? (
            <div className="off-gw-empty">No local changes</div>
          ) : null}
        </div>
      </div>

      <div className="off-gw-section">
        <CapsLabel>Diff preview</CapsLabel>
        <pre className="off-gw-diff">
          {workbench.diffPreview.map((line, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
              key={i}
              className={cn('off-gw-diff-line', `is-${line.kind}`)}
            >
              {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
              {line.text}
            </span>
          ))}
        </pre>
      </div>

      <div className="off-gw-checks">
        {workbench.checks.map((check) => (
          <span key={check.id} className={cn('off-gw-check', `is-${check.state}`)}>
            <span className="off-gw-check-dot" />
            {check.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setProject = useUiState((s) => s.setProject);
  const collapsed = useUiState((s) => s.officeLeftRailCollapsed);
  const setCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);
  const queryClient = useQueryClient();
  const projects = useProjects(companyId);
  const git = useGitWorkbench(projectId);
  const project = projects.data?.find((p) => p.id === projectId);
  const [tab, setTab] = useState<PanelTab>('files');
  const [bindingFolder, setBindingFolder] = useState(false);
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
      toast.error('Select a project before binding a folder');
      return;
    }
    setBindingFolder(true);
    try {
      const folder = await pickWorkspaceFolder('Bind project workspace folder');
      if (!folder) return;
      const overbroad = await overbroadWorkspaceReason(folder);
      if (overbroad) {
        toast.error(overbroad);
        return;
      }
      const repos = await reposOrNull();
      if (!repos) {
        toast.error('Project binding requires the desktop runtime');
        return;
      }
      await repos.projects.update(targetProject.id, { workspace_root: folder });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['project-files', targetProject.id] }),
        queryClient.invalidateQueries({ queryKey: ['git-workbench', targetProject.id] }),
      ]);
      setProject(targetProject.id);
      setTab('files');
      toast.success('Workspace folder bound');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Workspace binding failed');
    } finally {
      setBindingFolder(false);
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

  if (collapsed) {
    return (
      <aside className="off-ws-panel is-collapsed" aria-label="Workspace panel">
        <button
          type="button"
          className="off-rail-collapse-btn off-focusable"
          onClick={() => setCollapsed(false)}
          title="Expand workspace"
        >
          <Icon icon={ChevronsRight} size="sm" />
        </button>
        <button
          type="button"
          className={cn('off-rail-icon-tab off-focusable', tab === 'projects' && 'is-active')}
          onClick={() => {
            setTab('projects');
            setCollapsed(false);
          }}
          title="Projects"
        >
          <Icon icon={FolderGit2} size="sm" />
          <span>Projects</span>
        </button>
        <button
          type="button"
          className={cn('off-rail-icon-tab off-focusable', tab === 'files' && 'is-active')}
          onClick={() => {
            setTab('files');
            setCollapsed(false);
          }}
          title="Files"
        >
          <Icon icon={FileText} size="sm" />
          <span>Files</span>
        </button>
        <button
          type="button"
          className={cn('off-rail-icon-tab off-focusable', tab === 'git' && 'is-active')}
          onClick={() => {
            setTab('git');
            setCollapsed(false);
          }}
          title="Git"
        >
          <Icon icon={GitBranch} size="sm" />
          <span>Git</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="off-ws-panel">
      <button
        type="button"
        className="off-rail-collapse-edge off-ws-collapse-edge off-focusable"
        onClick={() => setCollapsed(true)}
        title="Collapse workspace"
      >
        <Icon icon={ChevronsLeft} size="sm" />
      </button>
      <div className="off-ws-head">
        <Tabs value={tab} onValueChange={(value) => setTab(value as PanelTab)}>
          <TabsList className="off-ws-tabs" aria-label="Workspace panel">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
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
      ) : tab === 'files' ? (
        <FilesTab
          projectId={projectId}
          workspaceRoot={project?.workspaceRoot ?? null}
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
      ) : git.data ? (
        <GitTab workbench={git.data} />
      ) : !project?.workspaceRoot ? (
        // Same task as the Files empty state, so same copy + affordance.
        <EmptyState
          icon={FolderClosed}
          title="No workspace bound"
          description="Bind a local folder to give this project file context for runs."
          action={{ label: 'Bind folder', onClick: () => void bindWorkspaceFolder() }}
        />
      ) : (
        // A folder is bound but the workbench resolved to null → it is not a
        // git repository (useGitWorkbench folds both causes into null).
        <EmptyState
          icon={GitBranch}
          title="Not a git repository"
          description="The bound folder has no git repository. Bind a folder that contains one."
          action={{ label: 'Rebind folder', onClick: () => void bindWorkspaceFolder() }}
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
