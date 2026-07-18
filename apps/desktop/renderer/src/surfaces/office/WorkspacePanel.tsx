import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import {
  type CommandExecResult,
  commitGitChanges,
  createPullRequest,
  getGhAuthStatus,
  getOriginRemote,
  getPullRequestStatus,
  initGitRepository,
  listPullRequests,
  pushGitBranch,
  stageGitFiles,
  switchGitBranch,
  viewPullRequest,
} from '@/data/git-workbench.js';
import { useGitWorkbench, useProjectFiles, useProjects } from '@/data/queries.js';
import type { FileNode, GitFileChange, GitWorkbench, Project } from '@/data/types.js';
import { parseUnifiedDiffFiles } from '@/data/unified-diff.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Select } from '@/design-system/grammar/Select.js';
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
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { pickWorkspaceFolder } from '@/lib/desktop-dialog.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import { useReviewPrPrefill } from '@/surfaces/office/board/review-pr-prefill.js';
import {
  useProjectWorkspaceLeaseReviews,
  useTaskBoard,
} from '@/surfaces/office/board/task-board-data.js';
import { openFirstRunGuide } from '@/surfaces/onboarding/first-run-state.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ExternalLink,
  FileText,
  Folder,
  FolderClosed,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  GitPullRequest,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProjectDialog } from './ProjectDialog.js';
import { openStageFilePreview } from './stage-viewer/file-preview.js';

type PanelTab = 'projects' | 'files' | 'git';
const FILE_PREVIEW_BYTES = 12_000;

function resolveWorkspacePanelTab(
  activeProjectId: string | null | undefined,
  requestedTab: PanelTab,
): PanelTab {
  return activeProjectId?.trim() ? requestedTab : 'projects';
}

interface FileContextMenuState {
  node: FileNode;
  x: number;
  y: number;
}

function compactPath(path: string | null | undefined) {
  if (!path) return 'Project folder not chosen';
  return path.replace(/^\/Users\/[^/]+/u, '~');
}

function folderName(path: string | null | undefined) {
  if (!path) return 'Project folder';
  return path.replace(/\/$/u, '').split('/').at(-1) || 'Project folder';
}

const STATUS_GLYPH: Record<GitFileChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

function commandOutput(result: CommandExecResult) {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
}

async function loadGitConnections(projectId: string) {
  const [originResult, authResult] = await Promise.allSettled([
    getOriginRemote(projectId),
    getGhAuthStatus(projectId),
  ]);
  const rejected = (reason: unknown): CommandExecResult => ({
    ok: false,
    stdout: '',
    stderr: reason instanceof Error ? reason.message : String(reason),
  });
  return {
    origin:
      originResult.status === 'fulfilled' ? originResult.value : rejected(originResult.reason),
    auth: authResult.status === 'fulfilled' ? authResult.value : rejected(authResult.reason),
  };
}

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
        title="No Project folder"
        description="Choose the folder that contains this Project’s files."
        action={{ label: 'Choose folder', onClick: onBindFolder }}
      />
    );
  }
  if (files.isLoading) return <SkeletonRows rows={6} />;

  const fileError = files.error;
  if (fileError) {
    return (
      <ErrorState
        title="Project files unavailable"
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
      await invokeCommand(command, { projectId, path: node.path });
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

  async function openWorkspaceRoot() {
    if (!isTauriRuntime()) {
      toast.error('File actions require the desktop runtime');
      return;
    }
    try {
      await invokeCommand('open_local_path', { projectId, path: '.' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the Project folder');
    }
  }

  return (
    <>
      <div className="off-ws-toolbar">
        <span className="off-ws-wsroot" title={workspaceRoot}>
          <Icon icon={FolderOpen} size="sm" />
          {folderName(workspaceRoot)}
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
              onClick={() => {
                // Single click opens the file preview (same gesture as the Git
                // tab); directories only select — Enter/context menu reveal them.
                if (node.kind === 'dir') selectNode(node);
                else void previewNode(node);
              }}
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
                icon={node.kind === 'dir' ? Folder : FileText}
                size="sm"
                className="off-tree-icon"
              />
              {node.name}
            </button>
          ))
        ) : (
          <EmptyState
            icon={FileText}
            title={files.data?.length ? 'No matching files' : 'Project folder is empty'}
            description={
              files.data?.length
                ? 'Clear the search to return to the full project file list.'
                : 'Add files to the Project folder, then rescan.'
            }
            action={
              files.data?.length
                ? undefined
                : { label: 'Open Project folder', onClick: () => void openWorkspaceRoot() }
            }
            secondaryAction={
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
                    title="Change folder"
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
            description="Create a Project and choose where its files live."
            action={{ label: 'New project', onClick: onNew }}
            secondaryAction={{ label: 'Show setup guide', onClick: openFirstRunGuide }}
          />
        )}
      </div>
    </div>
  );
}

function GitTab({
  workbench,
  companyId,
  projectId,
}: {
  workbench: GitWorkbench;
  companyId: string;
  projectId: string;
}) {
  const projectIdRef = useRef(projectId);
  const projectGenerationRef = useRef(0);
  if (projectIdRef.current !== projectId) {
    projectIdRef.current = projectId;
    projectGenerationRef.current += 1;
  }
  const captureProjectScope = () => ({
    projectId: projectIdRef.current,
    generation: projectGenerationRef.current,
  });
  const isCurrentProjectScope = (scope: { projectId: string; generation: number }) =>
    scope.projectId === projectIdRef.current && scope.generation === projectGenerationRef.current;
  const openStageView = useUiState((s) => s.openStageView);
  const setStageMaximized = useUiState((s) => s.setOfficeStageMaximized);
  const queryClient = useQueryClient();
  const leaseReviews = useProjectWorkspaceLeaseReviews(projectId);
  const board = useTaskBoard(companyId);
  const taskByRun = new Map(
    board.rows.flatMap((row) => [row, ...row.children]).map((row) => [row.runId, row]),
  );
  const reviewable = leaseReviews.rows.filter((lease) => lease.status === 'pending_review');
  const [selectedLeaseId, setSelectedLeaseId] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [origin, setOrigin] = useState<CommandExecResult | null>(null);
  const [ghAuth, setGhAuth] = useState<CommandExecResult | null>(null);
  const [prStatus, setPrStatus] = useState<CommandExecResult | null>(null);
  const [prList, setPrList] = useState<CommandExecResult | null>(null);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prBase, setPrBase] = useState('');
  const [prDraft, setPrDraft] = useState(false);
  const prPrefill = useReviewPrPrefill(projectId);
  const consumedPrPrefillId = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'push' | 'create-pr' | 'view-pr' | null>(null);
  const [lastOutput, setLastOutput] = useState<{ label: string; result: CommandExecResult } | null>(
    null,
  );
  const selectedLease =
    reviewable.find((lease) => lease.leaseId === selectedLeaseId) ?? reviewable[0] ?? null;
  const task = selectedLease ? taskByRun.get(selectedLease.runId) : null;
  const selectedLeaseDocument = useMemo(
    () => parseUnifiedDiffFiles(selectedLease?.files ?? []),
    [selectedLease?.files],
  );

  const openLeaseReview = (lease: (typeof reviewable)[number]) => {
    openStageView({
      kind: 'changes',
      leaseId: lease.leaseId,
      path: lease.files[0]?.path,
      files: lease.files,
      status: lease.status,
    });
    setStageMaximized(true);
  };

  useEffect(() => {
    const generation = projectGenerationRef.current;
    void loadGitConnections(projectId).then((connections) => {
      if (projectIdRef.current !== projectId || projectGenerationRef.current !== generation) {
        return;
      }
      setOrigin(connections.origin);
      setGhAuth(connections.auth);
    });
    return () => {
      projectGenerationRef.current += 1;
    };
  }, [projectId]);

  useEffect(() => {
    if (!prPrefill || consumedPrPrefillId.current === prPrefill.id) return;
    consumedPrPrefillId.current = prPrefill.id;
    setPrTitle((current) => current.trim() || prPrefill.title);
    setPrBody((current) =>
      current.includes(prPrefill.body)
        ? current
        : current.trim()
          ? `${current.trim()}\n\n${prPrefill.body}`
          : prPrefill.body,
    );
    setPrDraft(true);
  }, [prPrefill]);

  const refreshConnections = async () => {
    const scope = captureProjectScope();
    setBusy('Check setup');
    const connections = await loadGitConnections(scope.projectId);
    if (!isCurrentProjectScope(scope)) return;
    setOrigin(connections.origin);
    setGhAuth(connections.auth);
    setLastOutput({ label: 'GitHub CLI auth status', result: connections.auth });
    setBusy(null);
  };

  const refreshGit = async (targetProjectId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['git-workbench', targetProjectId] });
  };

  const execute = async (
    label: string,
    operation: (targetProjectId: string) => Promise<CommandExecResult>,
    afterSuccess?: (targetProjectId: string) => void | Promise<void>,
  ) => {
    const scope = captureProjectScope();
    setBusy(label);
    try {
      const result = await operation(scope.projectId);
      if (!isCurrentProjectScope(scope)) return;
      setLastOutput({ label, result });
      if (!result.ok) {
        toast.error(`${label} failed`);
        return;
      }
      await afterSuccess?.(scope.projectId);
      if (!isCurrentProjectScope(scope)) return;
      toast.success(`${label} completed`);
    } catch (error) {
      if (!isCurrentProjectScope(scope)) return;
      const result = {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      };
      setLastOutput({ label, result });
      toast.error(`${label} failed`);
    } finally {
      if (isCurrentProjectScope(scope)) setBusy(null);
    }
  };

  const refreshPullRequests = async (recordOutput = true) => {
    const scope = captureProjectScope();
    setBusy('Refresh PRs');
    try {
      const [status, list] = await Promise.all([
        getPullRequestStatus(scope.projectId),
        listPullRequests(scope.projectId),
      ]);
      if (!isCurrentProjectScope(scope)) return;
      setPrStatus(status);
      setPrList(list);
      if (recordOutput) setLastOutput({ label: 'PR status', result: status.ok ? list : status });
    } catch (error) {
      if (!isCurrentProjectScope(scope)) return;
      setLastOutput({
        label: 'Refresh PRs',
        result: {
          ok: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      if (isCurrentProjectScope(scope)) setBusy(null);
    }
  };

  return (
    <div className="off-gw">
      <div className="off-gw-branch">
        <Icon icon={GitBranch} size="sm" />
        <span className="off-gw-branch-name">{workbench.branch}</span>
        <span className="off-gw-counts">
          ↑{workbench.ahead} ↓{workbench.behind}
        </span>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Stage &amp; commit</CapsLabel>
        <div className="off-gw-files">
          {workbench.changes.map((change) => (
            <label key={`stage-${change.path}`} className="off-gw-stage-row">
              <input
                type="checkbox"
                checked={change.staged || selectedPaths.includes(change.path)}
                disabled={change.staged || busy !== null}
                onChange={(event) =>
                  setSelectedPaths((current) =>
                    event.target.checked
                      ? [...current, change.path]
                      : current.filter((path) => path !== change.path),
                  )
                }
              />
              <span className="off-gw-path">{change.path}</span>
              <span>{change.staged ? 'staged' : 'unstaged'}</span>
            </label>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={selectedPaths.length === 0 || busy !== null}
          onClick={() =>
            void execute(
              'Stage files',
              (targetProjectId) => stageGitFiles(targetProjectId, selectedPaths),
              async (targetProjectId) => {
                setSelectedPaths([]);
                await refreshGit(targetProjectId);
              },
            )
          }
        >
          Stage selected ({selectedPaths.length})
        </Button>
        <Input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          aria-label="Commit message"
        />
        <Button
          size="sm"
          disabled={!commitMessage.trim() || busy !== null}
          onClick={() =>
            void execute(
              'Commit',
              (targetProjectId) => commitGitChanges(targetProjectId, commitMessage.trim()),
              async (targetProjectId) => {
                setCommitMessage('');
                await refreshGit(targetProjectId);
              },
            )
          }
        >
          Commit staged changes
        </Button>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Branch</CapsLabel>
        <Input
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          placeholder="feature/branch-name"
          aria-label="Branch name"
        />
        <div className="off-gw-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={!branchName.trim() || busy !== null}
            onClick={() =>
              void execute(
                'Switch branch',
                (targetProjectId) => switchGitBranch(targetProjectId, branchName.trim(), false),
                refreshGit,
              )
            }
          >
            Switch
          </Button>
          <Button
            size="sm"
            disabled={!branchName.trim() || busy !== null}
            onClick={() =>
              void execute(
                'Create branch',
                (targetProjectId) => switchGitBranch(targetProjectId, branchName.trim(), true),
                async (targetProjectId) => {
                  setBranchName('');
                  await refreshGit(targetProjectId);
                },
              )
            }
          >
            Create &amp; switch
          </Button>
        </div>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Push</CapsLabel>
        {origin?.ok ? (
          <div className="off-gw-remote">origin · {origin.stdout.trim()}</div>
        ) : (
          <div className="off-gw-guidance">
            No origin remote is configured. Add origin in a terminal, then refresh this panel.
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!origin?.ok || workbench.branch === 'detached' || busy !== null}
          onClick={() => setConfirming('push')}
        >
          <Upload size={14} /> Push {workbench.branch}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void refreshConnections()}
        >
          Check remote &amp; CLI setup
        </Button>
      </div>

      <div className="off-gw-section off-gw-action-section">
        <CapsLabel>Pull requests</CapsLabel>
        {ghAuth?.ok ? (
          <div className="off-gw-guidance is-ok">GitHub CLI authenticated.</div>
        ) : (
          <div className="off-gw-guidance">
            GitHub CLI is unavailable or not logged in. Install `gh` or run `gh auth login` in a
            terminal, then refresh.
          </div>
        )}
        {ghAuth ? <pre className="off-gw-output">{commandOutput(ghAuth)}</pre> : null}
        <div className="off-gw-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={!ghAuth?.ok || busy !== null}
            onClick={() => void refreshPullRequests()}
          >
            Refresh PRs
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ghAuth?.ok || busy !== null}
            onClick={() =>
              void execute('View PR', (targetProjectId) => viewPullRequest(targetProjectId))
            }
          >
            View current
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ghAuth?.ok || busy !== null}
            onClick={() => setConfirming('view-pr')}
          >
            Open web
          </Button>
        </div>
        {prStatus ? <pre className="off-gw-output">{commandOutput(prStatus)}</pre> : null}
        {prList ? <pre className="off-gw-output">{commandOutput(prList)}</pre> : null}
        <Input
          value={prTitle}
          onChange={(event) => setPrTitle(event.target.value)}
          placeholder="PR title"
          aria-label="PR title"
        />
        <Textarea
          value={prBody}
          onChange={(event) => setPrBody(event.target.value)}
          placeholder="PR body"
          aria-label="PR body"
          rows={4}
        />
        <Input
          value={prBase}
          onChange={(event) => setPrBase(event.target.value)}
          placeholder="Base branch (optional)"
          aria-label="PR base branch"
        />
        <label className="off-gw-check-row">
          <input
            type="checkbox"
            checked={prDraft}
            onChange={(event) => setPrDraft(event.target.checked)}
          />
          Create as draft
        </label>
        <Button
          className="off-gw-pr-create"
          size="sm"
          disabled={!ghAuth?.ok || !prTitle.trim() || busy !== null}
          onClick={() => setConfirming('create-pr')}
        >
          <GitPullRequest size={14} /> <span>Review PR creation</span>
        </Button>
      </div>

      {selectedLease ? (
        <div className="off-gw-section">
          <CapsLabel>Task diff review</CapsLabel>
          <Select
            className="off-gw-task-select off-focusable"
            value={selectedLease.leaseId}
            onChange={(event) => {
              const next = reviewable.find((lease) => lease.leaseId === event.target.value);
              setSelectedLeaseId(event.target.value);
              if (next) openLeaseReview(next);
            }}
            aria-label="Delegated task diff"
            options={reviewable.map((lease) => ({
              value: lease.leaseId,
              label: taskByRun.get(lease.runId)?.objective ?? lease.runId,
            }))}
          />
          <div className="off-gw-review-entry">
            <div className="off-gw-review-entry-head">
              <span>Pending review</span>
              <strong>{selectedLeaseDocument.files.length} files</strong>
            </div>
            <p>{task?.objective ?? selectedLease.branch ?? selectedLease.leaseId}</p>
            <div className="off-gw-review-entry-stats">
              <span>+{selectedLeaseDocument.additions}</span>
              <span>−{selectedLeaseDocument.deletions}</span>
              <span>{selectedLeaseDocument.files.length} files</span>
            </div>
            <Button size="sm" onClick={() => openLeaseReview(selectedLease)}>
              <GitCompareArrows size={14} /> Open review stage
            </Button>
          </div>
        </div>
      ) : null}

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
      {lastOutput ? (
        <div className={cn('off-gw-result', lastOutput.result.ok ? 'is-ok' : 'is-error')}>
          <strong>{lastOutput.label}</strong>
          <pre>{commandOutput(lastOutput.result) || 'Completed with no output.'}</pre>
        </div>
      ) : null}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent showClose={false} className="off-dialog-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirming === 'push'
                ? 'Confirm push'
                : confirming === 'create-pr'
                  ? 'Confirm pull request'
                  : 'Open pull request in browser'}
            </DialogTitle>
            <DialogDescription>
              {confirming === 'push'
                ? 'This updates the shared origin remote.'
                : confirming === 'create-pr'
                  ? 'Review the exact title, body and base before creating the remote pull request.'
                  : 'This opens the current pull request using GitHub CLI.'}
            </DialogDescription>
          </DialogHeader>
          {confirming === 'push' ? (
            <dl className="off-gw-confirm">
              <dt>Remote</dt>
              <dd>origin</dd>
              <dt>Branch</dt>
              <dd>{workbench.branch}</dd>
            </dl>
          ) : confirming === 'create-pr' ? (
            <dl className="off-gw-confirm">
              <dt>Title</dt>
              <dd>{prTitle}</dd>
              <dt>Base</dt>
              <dd>{prBase || 'repository default'}</dd>
              <dt>Mode</dt>
              <dd>{prDraft ? 'draft' : 'ready for review'}</dd>
              <dt>Body</dt>
              <dd className="is-prewrap">{prBody || '(empty)'}</dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                if (action === 'push') {
                  void execute(
                    'Push',
                    (targetProjectId) => pushGitBranch(targetProjectId, workbench.branch),
                    refreshGit,
                  );
                } else if (action === 'create-pr') {
                  void execute(
                    'Create PR',
                    (targetProjectId) =>
                      createPullRequest(targetProjectId, {
                        title: prTitle.trim(),
                        body: prBody,
                        base: prBase.trim() || undefined,
                        draft: prDraft,
                      }),
                    async () => {
                      setPrTitle('');
                      setPrBody('');
                      setPrBase('');
                      setPrDraft(false);
                      await refreshPullRequests(false);
                    },
                  );
                } else if (action === 'view-pr') {
                  void execute('Open PR', (targetProjectId) =>
                    viewPullRequest(targetProjectId, true),
                  );
                }
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
