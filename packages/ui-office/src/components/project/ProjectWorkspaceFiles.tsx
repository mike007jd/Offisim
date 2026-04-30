import { ChevronLeft, FileText, Folder, RefreshCw } from 'lucide-react';
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

export function ProjectWorkspaceFiles({ workspaceRoot }: ProjectWorkspaceFilesProps) {
  const desktopMode = isProjectWorkspaceFilesAvailable();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<ProjectWorkspaceEntry[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selection, dispatchSelection] = useReducer(selectionReducer, null);
  // Bumped on every preview request and on workspaceRoot change so in-flight
  // fetches that resolve after the user moved on (workspace switch, new click)
  // get dropped instead of writing stale content into the new selection.
  const previewRequestId = useRef(0);

  const displayPath = currentPath ? `/${currentPath}` : '/';
  const directoryRequest = useMemo(
    () => ({ path: currentPath || '.', version: reloadVersion }),
    [currentPath, reloadVersion],
  );

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
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot || !desktopMode) return;
    let cancelled = false;
    setDirectoryLoading(true);
    setDirectoryError(null);
    void listProjectWorkspaceDirectory({
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
  }, [workspaceRoot, desktopMode, directoryRequest]);

  async function openFile(entry: ProjectWorkspaceEntry) {
    if (!workspaceRoot) return;
    if (selection?.kind === 'loading') return;
    const id = ++previewRequestId.current;
    dispatchSelection({ type: 'select', path: entry.path });
    try {
      const preview = await readProjectWorkspaceFilePreview({
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
      <div className="border-t border-border-subtle pt-2 text-[11px] text-text-muted">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3 w-3" />
          <span>No workspace folder</span>
        </div>
      </div>
    );
  }

  if (!desktopMode) {
    return (
      <div className="border-t border-border-subtle pt-2 text-[11px] text-text-muted">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3 w-3" />
          <span>Desktop files only</span>
        </div>
      </div>
    );
  }

  const selectedFilePath = selection?.path ?? null;

  return (
    <div className="border-t border-border-subtle pt-2">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
        <span className="min-w-0 flex-1 truncate" title={displayPath}>
          Workspace files {displayPath}
        </span>
        <button
          type="button"
          className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          onClick={() => setReloadVersion((version) => version + 1)}
          disabled={directoryLoading}
          aria-label="Refresh workspace files"
          title="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${directoryLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {currentPath && (
        <button
          type="button"
          className="mb-1 flex items-center gap-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
          onClick={() => {
            dispatchSelection({ type: 'clear' });
            setCurrentPath(parentWorkspacePath(currentPath));
          }}
        >
          <ChevronLeft className="h-3 w-3" />
          Up
        </button>
      )}

      <div className="max-h-36 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <button
            type="button"
            key={entry.path || entry.name}
            className={`flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-surface-hover ${
              selectedFilePath === entry.path ? 'bg-accent-muted text-accent-text' : 'text-text-secondary'
            }`}
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
              <Folder className="h-3 w-3 flex-shrink-0 text-info" />
            ) : (
              <FileText className="h-3 w-3 flex-shrink-0 text-text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {!entry.isDirectory && (
              <span className="flex-shrink-0 text-[10px] text-text-muted">
                {formatWorkspaceFileSize(entry.size)}
              </span>
            )}
          </button>
        ))}
        {!directoryLoading && entries.length === 0 && (
          <div className="px-1.5 py-2 text-[11px] text-text-muted">Empty folder</div>
        )}
      </div>

      {selection?.kind === 'loading' && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-surface px-2 py-1.5 text-[10px] leading-relaxed text-text-secondary">
          Loading...
        </pre>
      )}

      {selection?.kind === 'ready' && (
        <div className="mt-2 space-y-1">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-surface px-2 py-1.5 text-[10px] leading-relaxed text-text-secondary">
            {selection.preview}
          </pre>
          {selection.truncated && (
            <p className="text-[10px] text-text-muted">
              preview truncated · {formatWorkspaceFileSize(selection.totalSize)} total
            </p>
          )}
        </div>
      )}

      {selection?.kind === 'error' && (
        <div className="mt-2 rounded border border-error bg-error-muted px-2 py-1 text-[10px] text-error">
          {selection.message}
        </div>
      )}

      {directoryError && (
        <div className="mt-2 rounded border border-error bg-error-muted px-2 py-1 text-[10px] text-error">
          {directoryError}
        </div>
      )}
    </div>
  );
}
