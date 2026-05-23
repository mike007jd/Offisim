import type { ProjectRow } from '@offisim/shared-types';
import { Button, Checkbox, Textarea, cn } from '@offisim/ui-core';
import { isTauri } from '@offisim/ui-office/web';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface ProjectFilePreview {
  content: string;
  truncated: boolean;
  totalSize: number;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface GitFileChange {
  path: string;
  status: string;
  label: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  added: number | null;
  deleted: number | null;
}

interface GitSnapshot {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remoteUrl: string | null;
  files: GitFileChange[];
}

interface GitWorkbenchProps {
  activeProject: ProjectRow | null;
}

const EMPTY_SNAPSHOT: GitSnapshot = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  remoteUrl: null,
  files: [],
};

export function GitWorkbench({ activeProject }: GitWorkbenchProps) {
  const projectId = activeProject?.project_id ?? null;
  const workspaceRoot = activeProject?.workspace_root ?? null;
  const [snapshot, setSnapshot] = useState<GitSnapshot>(EMPTY_SNAPSHOT);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [diff, setDiff] = useState('');
  const [diffMessage, setDiffMessage] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUseGit = Boolean(projectId && workspaceRoot && isTauri());

  const gitExec = useCallback(
    async (args: string[]) => {
      if (!projectId) throw new Error('Project is required for Git commands.');
      const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
      const result = await invoke<GitExecResult>('git_exec', {
        args,
        cwd: '.',
        projectId,
      });
      return result;
    },
    [projectId],
  );

  const refresh = useCallback(async () => {
    if (!canUseGit) {
      setSnapshot(EMPTY_SNAPSHOT);
      setSelectedPath(null);
      setSelectedPaths(new Set());
      setDiff('');
      setDiffMessage(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const repo = await gitExec(['rev-parse', '--is-inside-work-tree']);
      if (!repo.ok || repo.stdout.trim() !== 'true') {
        setSnapshot(EMPTY_SNAPSHOT);
        setSelectedPath(null);
        setSelectedPaths(new Set());
        setDiff('');
        setDiffMessage('Workspace folder is not a Git repository.');
        return;
      }

      const [branchResult, statusResult, numstatResult, remoteResult] = await Promise.all([
        gitExec(['rev-parse', '--abbrev-ref', 'HEAD']),
        gitExec(['status', '--porcelain=v1', '--branch', '--untracked-files=all']),
        gitExec(['diff', '--numstat']),
        gitExec(['remote', 'get-url', 'origin']),
      ]);

      if (!statusResult.ok) {
        throw new Error(statusResult.stderr || 'git status failed');
      }

      const lines = statusResult.stdout.split(/\r?\n/u).filter(Boolean);
      const branchStatus = parseBranchStatus(lines.find((line) => line.startsWith('##')) ?? '');
      const stats = parseNumstat(numstatResult.ok ? numstatResult.stdout : '');
      const files = lines
        .filter((line) => !line.startsWith('##'))
        .map((line) => parseStatusLine(line, stats))
        .filter((file): file is GitFileChange => Boolean(file));
      const branch =
        branchResult.ok && branchResult.stdout.trim() && branchResult.stdout.trim() !== 'HEAD'
          ? branchResult.stdout.trim()
          : branchStatus.branch;
      const nextSnapshot: GitSnapshot = {
        branch,
        upstream: branchStatus.upstream,
        ahead: branchStatus.ahead,
        behind: branchStatus.behind,
        remoteUrl: remoteResult.ok ? remoteResult.stdout.trim() || null : null,
        files,
      };
      setSnapshot(nextSnapshot);
      setSelectedPath((current) =>
        current && files.some((file) => file.path === current) ? current : (files[0]?.path ?? null),
      );
      setSelectedPaths(new Set());
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canUseGit, gitExec]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedFile = useMemo(
    () => snapshot.files.find((file) => file.path === selectedPath) ?? null,
    [selectedPath, snapshot.files],
  );

  useEffect(() => {
    if (!canUseGit || !selectedFile) {
      setDiff('');
      setDiffMessage(selectedFile ? null : 'Select a changed file to preview its diff.');
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffMessage(null);
    void (async () => {
      try {
        if (selectedFile.untracked) {
          const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
          const preview = await invoke<ProjectFilePreview>('project_read_file_preview', {
            path: selectedFile.path,
            cwd: workspaceRoot,
            maxBytes: 32768,
            projectId,
          });
          if (!cancelled) {
            const suffix = preview.truncated
              ? `\n\n[preview truncated at 32 KB of ${preview.totalSize} bytes]`
              : '';
            setDiff(
              preview.content
                ? `# Untracked file preview: ${selectedFile.path}\n\n${preview.content}${suffix}`
                : '',
            );
            setDiffMessage(
              preview.content ? null : 'Untracked file is empty or not text-readable.',
            );
          }
          return;
        }
        let result = await gitExec(['diff', '--', selectedFile.path]);
        if (result.ok && !result.stdout.trim() && selectedFile.staged) {
          result = await gitExec(['diff', '--cached', '--', selectedFile.path]);
        }
        if (!cancelled) {
          if (result.ok) {
            setDiff(result.stdout);
            setDiffMessage(result.stdout.trim() ? null : 'No textual diff for this file.');
          } else {
            setDiff('');
            setDiffMessage(result.stderr || 'git diff failed');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setDiff('');
          setDiffMessage(toMessage(err));
        }
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canUseGit, gitExec, projectId, selectedFile, workspaceRoot]);

  const selectedCount = selectedPaths.size;
  const canCommit =
    canUseGit && selectedCount > 0 && commitMessage.trim().length > 0 && !committing;
  const prStatus = useMemo(() => resolvePrStatus(snapshot), [snapshot]);

  const togglePath = useCallback((path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const setAllSelected = useCallback((checked: boolean, files: GitFileChange[]) => {
    setSelectedPaths(checked ? new Set(files.map((file) => file.path)) : new Set());
  }, []);

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    try {
      const paths = [...selectedPaths];
      const add = await gitExec(['add', '--', ...paths]);
      if (!add.ok) throw new Error(add.stderr || 'git add failed');
      const commit = await gitExec(['commit', '-m', commitMessage.trim(), '--', ...paths]);
      if (!commit.ok) throw new Error(commit.stderr || 'git commit failed');
      setCommitMessage('');
      setSelectedPaths(new Set());
      await refresh();
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setCommitting(false);
    }
  }, [canCommit, commitMessage, gitExec, refresh, selectedPaths]);

  if (!activeProject) {
    return (
      <GitUnavailable
        title="No project selected"
        message="Choose a project before inspecting local Git changes."
      />
    );
  }

  if (!workspaceRoot) {
    return (
      <GitUnavailable
        title="No workspace folder"
        message="Bind a local workspace folder to this project before using Git."
      />
    );
  }

  if (!isTauri()) {
    return (
      <GitUnavailable
        title="Desktop Git only"
        message="Git Workbench uses the desktop sandbox and is unavailable in the web preview."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface text-text-primary">
      <div className="border-b border-border-default px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
              Git Workbench
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate font-mono text-xs text-text-primary">
                {snapshot.branch ?? 'No branch'}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1 px-2 text-caption"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-caption">
          <GitMetric label="Files" value={String(snapshot.files.length)} />
          <GitMetric label="Ahead" value={String(snapshot.ahead)} />
          <GitMetric label="Behind" value={String(snapshot.behind)} />
        </div>

        <div className="mt-2 rounded-lg border border-border-subtle bg-surface-muted px-2 py-2 text-caption text-text-muted">
          <span className="font-semibold text-text-secondary">Local commit:</span> selected files
          only; no push or remote state is created here.
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="border-b border-error/30 bg-error-muted px-3 py-2 text-xs font-medium text-error"
        >
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="border-b border-border-default">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="inline-flex items-center gap-2 text-caption text-text-secondary">
              <Checkbox
                checked={snapshot.files.length > 0 && selectedCount === snapshot.files.length}
                onCheckedChange={(checked) => setAllSelected(checked === true, snapshot.files)}
                aria-label="Select all changed files"
              />
              {selectedCount} selected
            </div>
            <span className="text-caption uppercase tracking-wide text-text-muted">Status</span>
          </div>
          <div className="custom-scrollbar max-h-44 overflow-y-auto px-2 pb-2">
            {snapshot.files.length > 0 ? (
              snapshot.files.map((file) => (
                <GitFileRow
                  key={file.path}
                  file={file}
                  selected={selectedPath === file.path}
                  checked={selectedPaths.has(file.path)}
                  onSelect={() => setSelectedPath(file.path)}
                  onToggle={() => togglePath(file.path)}
                />
              ))
            ) : (
              <div className="rounded-lg border border-border-subtle bg-surface-muted px-3 py-4 text-center text-xs text-text-muted">
                Working tree clean
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col border-b border-border-default">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
              Diff preview
            </span>
            {selectedFile ? (
              <span className="truncate font-mono text-caption text-text-muted">
                {selectedFile.path}
              </span>
            ) : null}
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-surface-muted p-3">
            {diffLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-text-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading diff
              </div>
            ) : diff ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-text-primary">
                {diff}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
                {diffMessage ?? 'No diff selected'}
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3 px-3 py-3">
          <div className="rounded-lg border border-border-subtle bg-surface-muted p-2">
            <div className="mb-2 flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-text-secondary">
              <GitCommit className="h-3.5 w-3.5" />
              Commit
            </div>
            <Textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              rows={2}
              placeholder="Commit message"
              className="resize-none border-border-subtle px-2 py-2 text-xs"
            />
            <Button
              type="button"
              className="mt-2 h-8 w-full gap-2 px-3 text-xs"
              disabled={!canCommit}
              onClick={() => void handleCommit()}
            >
              {committing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitCommit className="h-3.5 w-3.5" />
              )}
              Commit selected files
            </Button>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-muted p-2">
            <div className="mb-1 flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-text-secondary">
              <GitPullRequest className="h-3.5 w-3.5" />
              PR-ready
            </div>
            <p className="text-caption leading-relaxed text-text-muted">{prStatus.message}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-8 w-full gap-2 px-3 text-xs"
              disabled={!prStatus.url}
              onClick={() => {
                if (prStatus.url) window.open(prStatus.url, '_blank', 'noopener,noreferrer');
              }}
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              Open compare
            </Button>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-muted p-2">
            <div className="mb-1 flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-text-secondary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Checks
            </div>
            <p className="text-caption text-text-muted">
              Unavailable. No real checks source is connected to this local workspace.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function GitUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
      <AlertCircle className="h-8 w-8 text-text-muted" />
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{message}</p>
      </div>
    </div>
  );
}

function GitMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-muted px-2 py-2">
      <div className="text-caption uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function GitFileRow({
  file,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  file: GitFileChange;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'mb-1 flex items-center gap-2 rounded-lg border px-2 py-2 text-left transition',
        selected
          ? 'border-border-focus bg-accent-muted'
          : 'border-border-subtle bg-surface-muted hover:border-border-default',
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start p-0 text-left hover:bg-transparent"
        onClick={onSelect}
      >
        <span className="flex min-w-0 flex-col items-start">
          <span className="flex min-w-0 items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="truncate font-mono text-caption text-text-primary">{file.path}</span>
          </span>
          <span className="mt-1 inline-flex rounded border border-border-subtle px-1.5 py-0.5 text-caption text-text-muted">
            {file.label}
          </span>
        </span>
      </Button>
      <div className="flex flex-col items-end gap-1 font-mono text-caption">
        <span className="inline-flex items-center gap-1 text-success">
          <Plus className="h-3 w-3" />
          {formatStat(file.added)}
        </span>
        <span className="inline-flex items-center gap-1 text-error">
          <Minus className="h-3 w-3" />
          {formatStat(file.deleted)}
        </span>
      </div>
    </div>
  );
}

function parseBranchStatus(line: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  const cleaned = line.replace(/^##\s*/u, '').trim();
  if (!cleaned) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const bracket = cleaned.match(/\[(?<meta>[^\]]+)\]/u)?.groups?.meta ?? '';
  const withoutBracket = cleaned.replace(/\s*\[[^\]]+\]\s*$/u, '');
  const [rawBranchPart = '', upstreamPart] = withoutBracket.split('...');
  const branchPart = rawBranchPart.trim();
  const noCommits = branchPart.match(/^No commits yet on (.+)$/u);
  const ahead = Number(bracket.match(/ahead\s+(\d+)/u)?.[1] ?? 0);
  const behind = Number(bracket.match(/behind\s+(\d+)/u)?.[1] ?? 0);
  const branch = noCommits?.[1] ?? branchPart;
  return {
    branch: branch || null,
    upstream: upstreamPart?.trim() || null,
    ahead,
    behind,
  };
}

function parseStatusLine(
  line: string,
  stats: Map<string, { added: number | null; deleted: number | null }>,
): GitFileChange | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const path = rawPath.includes(' -> ')
    ? (rawPath.split(' -> ').at(-1)?.trim() ?? rawPath)
    : rawPath;
  const stat = stats.get(path);
  return {
    path,
    status,
    label: statusLabel(status),
    staged: status[0] !== ' ' && status[0] !== '?',
    unstaged: status[1] !== ' ' || status === '??',
    untracked: status === '??',
    added: stat?.added ?? null,
    deleted: stat?.deleted ?? null,
  };
}

function parseNumstat(
  output: string,
): Map<string, { added: number | null; deleted: number | null }> {
  const stats = new Map<string, { added: number | null; deleted: number | null }>();
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t').trim();
    if (!path) continue;
    stats.set(path, {
      added: parseStat(addedRaw),
      deleted: parseStat(deletedRaw),
    });
  }
  return stats;
}

function statusLabel(status: string): string {
  if (status === '??') return 'Untracked';
  if (status.includes('A')) return 'Added';
  if (status.includes('M')) return 'Modified';
  if (status.includes('D')) return 'Deleted';
  if (status.includes('R')) return 'Renamed';
  if (status.includes('C')) return 'Copied';
  return status.trim() || 'Changed';
}

function parseStat(value: string | undefined): number | null {
  if (!value || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatStat(value: number | null): string {
  return value === null ? '-' : String(value);
}

function resolvePrStatus(snapshot: GitSnapshot): { message: string; url: string | null } {
  if (!snapshot.branch) return { message: 'No branch is checked out.', url: null };
  if (snapshot.branch === 'main' || snapshot.branch === 'master') {
    return { message: 'Create a feature branch before preparing a PR.', url: null };
  }
  if (!snapshot.upstream) {
    return {
      message: 'No upstream branch is configured. Commit locally here, then publish explicitly.',
      url: null,
    };
  }
  const url = githubCompareUrl(snapshot.remoteUrl, snapshot.branch);
  if (!url) {
    return { message: 'Origin is not a GitHub remote, so compare link is unavailable.', url: null };
  }
  return {
    message: 'Upstream branch exists. Open compare when you are ready to review or create a PR.',
    url,
  };
}

function githubCompareUrl(remoteUrl: string | null, branch: string): string | null {
  if (!remoteUrl) return null;
  const ssh = remoteUrl.match(/^git@github\.com:(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?$/u);
  const https = remoteUrl.match(
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?\/?$/u,
  );
  const groups = ssh?.groups ?? https?.groups;
  if (!groups?.owner || !groups.repo) return null;
  return `https://github.com/${groups.owner}/${groups.repo}/compare/${encodeURIComponent(branch)}?expand=1`;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
