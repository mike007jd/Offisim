import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import { useGitWorkbench, useProjectFiles, useProjects } from '@/data/queries.js';
import type { FileNode, GitFileChange, GitWorkbench } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { pickWorkspaceFolder } from '@/lib/desktop-dialog.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

type PanelTab = 'files' | 'git';
const FILE_PREVIEW_BYTES = 12_000;

interface FilePreviewState {
  path: string;
  content: string;
  truncated: boolean;
  totalSize: number;
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
  const files = useProjectFiles(projectId);
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  async function selectNode(node: FileNode) {
    setSelectedPath(node.path);
    setPreview(null);
    setPreviewError(null);
    if (node.kind === 'dir') return;
    if (!isTauriRuntime()) {
      setPreviewError('File preview requires the desktop runtime.');
      return;
    }
    setPreviewLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<FilePreviewState>('project_read_file_preview', {
        path: node.path,
        cwd: null,
        maxBytes: FILE_PREVIEW_BYTES,
        projectId,
      });
      setPreview({ ...result, path: node.path });
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'File preview failed.',
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function openNode(node: FileNode) {
    if (!isTauriRuntime()) {
      toast.error('Open requires the desktop runtime');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_local_path', { projectId, path: node.path });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Open local path failed',
      );
    }
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
              onClick={() => void selectNode(node)}
              onDoubleClick={() => void openNode(node)}
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
        {selectedPath ? (
          <section className="off-file-preview" aria-label="Selected workspace file">
            <div className="off-file-preview-head">
              <span>{selectedPath}</span>
              {preview ? <span>{preview.totalSize.toLocaleString()} B</span> : null}
            </div>
            {previewLoading ? (
              <div className="off-file-preview-empty">Loading preview...</div>
            ) : null}
            {previewError ? <div className="off-file-preview-error">{previewError}</div> : null}
            {preview ? (
              <pre className="off-file-preview-body">
                {preview.content}
                {preview.truncated ? '\n...' : ''}
              </pre>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}

function GitTab({ workbench }: { workbench: GitWorkbench }) {
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
            <div key={change.path} className="off-gw-file">
              <span className={cn('off-gw-status', `is-${change.status}`)}>
                {STATUS_GLYPH[change.status]}
              </span>
              {change.staged ? <span className="off-gw-stage">staged</span> : null}
              <span className="off-gw-path">{change.path}</span>
              <span className="off-gw-stat">
                <span className="off-gw-add">+{change.added}</span>
                <span className="off-gw-rem">−{change.removed}</span>
              </span>
            </div>
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

      <div className="off-gw-actions">
        <span className="off-gw-action-state">Commit flow pending reviewed message workflow</span>
        <span className="off-gw-action-state">PR flow pending Git provider binding</span>
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const queryClient = useQueryClient();
  const projects = useProjects(companyId);
  const git = useGitWorkbench(projectId);
  const project = projects.data?.find((p) => p.id === projectId);
  const [tab, setTab] = useState<PanelTab>('files');
  const [bindingFolder, setBindingFolder] = useState(false);

  const tabs = useMemo(
    () =>
      [
        { id: 'files' as const, label: 'Files' },
        { id: 'git' as const, label: 'Git' },
      ] satisfies Array<{ id: PanelTab; label: string }>,
    [],
  );

  async function bindWorkspaceFolder() {
    if (!project) {
      toast.error('Select a project before binding a folder');
      return;
    }
    setBindingFolder(true);
    try {
      const folder = await pickWorkspaceFolder('Bind project workspace folder');
      if (!folder) return;
      const repos = await reposOrNull();
      if (!repos) {
        toast.error('Project binding requires the desktop runtime');
        return;
      }
      await repos.projects.update(project.id, { workspace_root: folder });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['project-files', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['git-workbench', project.id] }),
      ]);
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

  return (
    <aside className="off-ws-panel">
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
            label="Rescan workspace"
            size="iconSm"
            onClick={() => void rescanWorkspace()}
            disabled={!project?.workspaceRoot || bindingFolder}
          />
        </div>
      </div>

      {tab === 'files' ? (
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
      ) : (
        <EmptyState
          icon={GitBranch}
          title="No git workspace"
          description="Bind a local folder with a git repository to use the workbench."
        />
      )}
    </aside>
  );
}
