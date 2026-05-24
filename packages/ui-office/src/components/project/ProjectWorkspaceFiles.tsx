import { Button, Input, cn } from '@offisim/ui-core';
import { ChevronLeft, FileText, Folder, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toErrorMessage } from '../../lib/error-message.js';
import {
  type ProjectWorkspaceEntry,
  formatWorkspaceFileSize,
  isProjectWorkspaceFilesAvailable,
  listProjectWorkspaceDirectory,
  parentWorkspacePath,
  readProjectWorkspaceFilePreview,
} from '../../lib/project-workspace-files.js';

interface ProjectWorkspaceFilesProps {
  projectId: string;
  workspaceRoot: string | null;
}

const PREVIEW_MAX_BYTES = 8192;

type Selection =
  | null
  | { kind: 'loading'; path: string }
  | {
      kind: 'ready';
      path: string;
      preview: string;
      truncated: boolean;
      totalSize: number;
    }
  | { kind: 'error'; path: string; message: string };

type SelectionAction =
  | { type: 'select'; path: string }
  | {
      type: 'previewLoaded';
      path: string;
      preview: string;
      truncated: boolean;
      totalSize: number;
    }
  | { type: 'previewFailed'; path: string; message: string }
  | { type: 'clear' };

function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'select':
      return { kind: 'loading', path: action.path };
    case 'previewLoaded':
      // Only commit when we're still loading the same path; null / error / ready
      // / different-path all mean the user moved on or another path is loading.
      if (!state || state.kind !== 'loading' || state.path !== action.path) return state;
      return {
        kind: 'ready',
        path: action.path,
        preview: action.preview,
        truncated: action.truncated,
        totalSize: action.totalSize,
      };
    case 'previewFailed':
      if (!state || state.kind !== 'loading' || state.path !== action.path) return state;
      return { kind: 'error', path: action.path, message: action.message };
    case 'clear':
      return null;
  }
}

export function ProjectWorkspaceFiles({ projectId, workspaceRoot }: ProjectWorkspaceFilesProps) {
  const desktopMode = isProjectWorkspaceFilesAvailable();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<ProjectWorkspaceEntry[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [selection, dispatchSelection] = useReducer(selectionReducer, null);
  // Bumped on every preview request and on workspaceRoot change so in-flight
  // fetches that resolve after the user moved on (workspace switch, new click)
  // get dropped instead of writing stale content into the new selection.
  const previewRequestId = useRef(0);

  const displayPath = currentPath ? `/${currentPath}` : '/';
  const rootHint = workspaceRoot ? workspaceRoot.replace(/^\/Users\/[^/]+/, '~') : null;
  const directoryRequest = useMemo(
    () => ({ path: currentPath || '.', version: reloadVersion }),
    [currentPath, reloadVersion],
  );
  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query),
    );
  }, [entries, search]);

  // Reset internal nav + selection when the parent passes a different
  // workspaceRoot (project switch). Replaces the old `key=` re-mount approach
  // so cosmetic parent re-renders no longer blow away nav state. Bumping
  // `previewRequestId` invalidates any in-flight preview fetch from the old
  // workspace so it can't write stale content into the new project's view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspaceRoot dep is the trigger, not a value the effect reads
  useEffect(() => {
    previewRequestId.current += 1;
    setCurrentPath('');
    dispatchSelection({ type: 'clear' });
  }, [workspaceRoot, projectId]);

  useEffect(() => {
    if (!workspaceRoot || !desktopMode) return;
    let cancelled = false;
    setDirectoryLoading(true);
    setDirectoryError(null);
    void listProjectWorkspaceDirectory({
      projectId,
      workspaceRoot,
      path: directoryRequest.path,
    })
      .then((nextEntries) => {
        if (!cancelled) setEntries(nextEntries);
      })
      .catch((err) => {
        if (!cancelled) {
          setEntries([]);
          setDirectoryError(toErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, projectId, desktopMode, directoryRequest]);

  async function openFile(entry: ProjectWorkspaceEntry) {
    if (!workspaceRoot) return;
    if (selection?.kind === 'loading') return;
    const id = ++previewRequestId.current;
    dispatchSelection({ type: 'select', path: entry.path });
    try {
      const preview = await readProjectWorkspaceFilePreview({
        projectId,
        workspaceRoot,
        path: entry.path,
        maxBytes: PREVIEW_MAX_BYTES,
      });
      if (id !== previewRequestId.current) return;
      dispatchSelection({
        type: 'previewLoaded',
        path: entry.path,
        preview: preview.content,
        truncated: preview.truncated,
        totalSize: preview.totalSize,
      });
    } catch (err) {
      if (id !== previewRequestId.current) return;
      dispatchSelection({
        type: 'previewFailed',
        path: entry.path,
        message: toErrorMessage(err),
      });
    }
  }

  if (!workspaceRoot) {
    return (
      <div className="project-workspace-files-empty">
        <div className="project-workspace-files-empty-message">
          <Folder className="size-3" aria-hidden="true" />
          <span>No workspace folder</span>
        </div>
      </div>
    );
  }

  if (!desktopMode) {
    return (
      <div className="project-workspace-files-empty">
        <div className="project-workspace-files-empty-message">
          <Folder className="size-3" aria-hidden="true" />
          <span>Desktop files only</span>
        </div>
      </div>
    );
  }

  const selectedFilePath = selection?.path ?? null;

  return (
    <div className="project-workspace-files-root">
      <div className="project-workspace-files-header">
        <div className="project-workspace-files-path-stack">
          <span className="project-workspace-files-kicker">Workspace files</span>
          <span className="project-workspace-files-path" title={workspaceRoot}>
            {rootHint}
            {displayPath}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="project-workspace-files-refresh"
          onClick={() => setReloadVersion((version) => version + 1)}
          disabled={directoryLoading}
          aria-label="Refresh workspace files"
          title="Refresh"
        >
          <RefreshCw className={cn('size-3', directoryLoading && 'animate-spin')} />
        </Button>
      </div>

      <div className="project-workspace-files-search">
        <Search className="project-workspace-files-search-icon" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search files..."
          className="project-workspace-files-search-input"
        />
      </div>

      {currentPath && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="project-workspace-files-up"
          onClick={() => {
            dispatchSelection({ type: 'clear' });
            setCurrentPath(parentWorkspacePath(currentPath));
          }}
        >
          <ChevronLeft className="size-3" aria-hidden="true" />
          Up
        </Button>
      )}

      <div className="project-workspace-files-list custom-scrollbar">
        {filteredEntries.map((entry) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            key={entry.path || entry.name}
            className={cn(
              'project-workspace-files-row',
              selectedFilePath === entry.path ? 'bg-accent-surface text-accent' : 'text-ink-2',
            )}
            onClick={() => {
              if (entry.isDirectory) {
                setCurrentPath(entry.path);
                dispatchSelection({ type: 'clear' });
              } else if (entry.isFile) {
                void openFile(entry);
              }
            }}
            title={entry.path}
          >
            {entry.isDirectory ? (
              <Folder className="size-3 flex-shrink-0 text-accent" aria-hidden="true" />
            ) : (
              <FileText className="size-3 flex-shrink-0 text-ink-3" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {!entry.isDirectory && (
              <span className="project-workspace-files-size">
                {formatWorkspaceFileSize(entry.size)}
              </span>
            )}
          </Button>
        ))}
        {!directoryLoading && entries.length > 0 && filteredEntries.length === 0 && (
          <div className="project-workspace-files-inline-empty">No files match this search.</div>
        )}
        {!directoryLoading && entries.length === 0 && (
          <div className="project-workspace-files-inline-empty">Empty folder</div>
        )}
      </div>

      {selection?.kind === 'loading' && (
        <pre className="project-workspace-files-preview">Loading...</pre>
      )}

      {selection?.kind === 'ready' && (
        <div className="project-workspace-files-preview-stack">
          <pre className="project-workspace-files-preview">{selection.preview}</pre>
          {selection.truncated && (
            <p className="text-fs-micro text-ink-3">
              preview truncated · {formatWorkspaceFileSize(selection.totalSize)} total
            </p>
          )}
        </div>
      )}

      {selection?.kind === 'error' && (
        <div className="project-workspace-files-error">{selection.message}</div>
      )}

      {directoryError && <div className="project-workspace-files-error">{directoryError}</div>}
    </div>
  );
}
