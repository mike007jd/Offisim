import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { useProjectFiles } from '@/data/queries.js';
import type { FileNode } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { FileText, Folder, FolderClosed, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { openStageFilePreview } from '../stage-viewer/file-preview.js';
import { FileContextMenu, type FileContextMenuState } from './FileContextMenu.js';

const FILE_PREVIEW_BYTES = 12_000;

function folderName(path: string | null | undefined) {
  if (!path) return 'Project folder';
  return path.replace(/\/$/u, '').split('/').at(-1) || 'Project folder';
}

export function FilesTab({
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
