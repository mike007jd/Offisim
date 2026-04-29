import { ChevronLeft, FileText, Folder, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type ProjectWorkspaceEntry,
  isProjectWorkspaceFilesAvailable,
  listProjectWorkspaceDirectory,
  readProjectWorkspaceFile,
} from '../../lib/project-workspace-files.js';

interface ProjectWorkspaceFilesProps {
  workspaceRoot: string | null;
}

const PREVIEW_LIMIT = 6000;

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function formatSize(size: number | null | undefined): string {
  if (typeof size !== 'number') return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

export function ProjectWorkspaceFiles({ workspaceRoot }: ProjectWorkspaceFilesProps) {
  const desktopMode = isProjectWorkspaceFilesAvailable();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<ProjectWorkspaceEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const displayPath = useMemo(() => (currentPath ? `/${currentPath}` : '/'), [currentPath]);
  const directoryRequest = useMemo(
    () => ({ path: currentPath || '.', version: reloadVersion }),
    [currentPath, reloadVersion],
  );

  useEffect(() => {
    if (!workspaceRoot || !desktopMode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
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
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, desktopMode, directoryRequest]);

  async function openFile(entry: ProjectWorkspaceEntry) {
    if (!workspaceRoot || previewLoading) return;
    setSelectedFile(entry.path);
    setPreview(null);
    setPreviewLoading(true);
    setError(null);
    try {
      const content = await readProjectWorkspaceFile({ workspaceRoot, path: entry.path });
      setPreview(
        content.length > PREVIEW_LIMIT
          ? `${content.slice(0, PREVIEW_LIMIT)}\n\n[preview truncated]`
          : content,
      );
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!workspaceRoot) {
    return (
      <div className="border-t border-white/8 pt-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3 w-3" />
          <span>No workspace folder</span>
        </div>
      </div>
    );
  }

  if (!desktopMode) {
    return (
      <div className="border-t border-white/8 pt-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3 w-3" />
          <span>Desktop files only</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-white/8 pt-2">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600">
        <span className="min-w-0 flex-1 truncate" title={displayPath}>
          Workspace files {displayPath}
        </span>
        <button
          type="button"
          className="rounded p-0.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
          onClick={() => setReloadVersion((version) => version + 1)}
          disabled={loading}
          aria-label="Refresh workspace files"
          title="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {currentPath && (
        <button
          type="button"
          className="mb-1 flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-slate-200"
          onClick={() => {
            setSelectedFile(null);
            setPreview(null);
            setCurrentPath(parentPath(currentPath));
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
            className={`flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-white/5 ${
              selectedFile === entry.path ? 'bg-white/8 text-slate-100' : 'text-slate-400'
            }`}
            onClick={() => {
              if (entry.isDirectory) {
                setCurrentPath(entry.path);
                setSelectedFile(null);
                setPreview(null);
              } else if (entry.isFile) {
                void openFile(entry);
              }
            }}
            title={entry.path}
          >
            {entry.isDirectory ? (
              <Folder className="h-3 w-3 flex-shrink-0 text-cyan-300/70" />
            ) : (
              <FileText className="h-3 w-3 flex-shrink-0 text-slate-500" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {!entry.isDirectory && (
              <span className="flex-shrink-0 text-[10px] text-slate-600">
                {formatSize(entry.size)}
              </span>
            )}
          </button>
        ))}
        {!loading && entries.length === 0 && (
          <div className="px-1.5 py-2 text-[11px] text-slate-600">Empty folder</div>
        )}
      </div>

      {(previewLoading || preview) && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/20 px-2 py-1.5 text-[10px] leading-relaxed text-slate-300">
          {previewLoading ? 'Loading...' : (preview ?? '')}
        </pre>
      )}

      {error && (
        <div className="mt-2 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
