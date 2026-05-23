import type { ProjectRow } from '@offisim/shared-types';
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
import {
  GitActionPanel,
  GitActionStack,
  GitActionTitle,
  GitBranchLine,
  GitBranchName,
  GitCheckbox,
  GitCommitTextarea,
  GitDiffEmpty,
  GitDiffLoading,
  GitDiffPane,
  GitDiffPath,
  GitDiffPre,
  GitDiffSection,
  GitEmptyPanel,
  GitErrorBanner,
  GitFileNameLine,
  GitFilePath,
  GitFileRowShell,
  GitFileSelectButton,
  GitFileStatusBadge,
  GitFileTextStack,
  GitIconSlot,
  GitInlineMeta,
  GitMetricCard,
  GitMetricGrid,
  GitMetricLabel,
  GitMetricValue,
  GitMutedLabel,
  GitNotice,
  GitNoticeStrong,
  GitPanelText,
  GitPrimaryButton,
  GitRefreshButton,
  GitScrollArea,
  GitSecondaryButton,
  GitSection,
  GitSectionHeader,
  GitStatLine,
  GitStatStack,
  GitUnavailableShell,
  GitUnavailableText,
  GitUnavailableTitle,
  GitWorkbenchBody,
  GitWorkbenchHeader,
  GitWorkbenchHeaderRow,
  GitWorkbenchKicker,
  GitWorkbenchShell,
  GitWorkbenchTitleStack,
} from './GitWorkbenchSurfaces';

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
    <GitWorkbenchShell>
      <GitWorkbenchHeader>
        <GitWorkbenchHeaderRow>
          <GitWorkbenchTitleStack>
            <GitWorkbenchKicker>Git Workbench</GitWorkbenchKicker>
            <GitBranchLine>
              <GitIconSlot>
                <GitBranch />
              </GitIconSlot>
              <GitBranchName>{snapshot.branch ?? 'No branch'}</GitBranchName>
            </GitBranchLine>
          </GitWorkbenchTitleStack>
          <GitRefreshButton type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? (
              <GitIconSlot state="loading">
                <Loader2 />
              </GitIconSlot>
            ) : (
              <GitIconSlot>
                <RefreshCw />
              </GitIconSlot>
            )}
            Refresh
          </GitRefreshButton>
        </GitWorkbenchHeaderRow>

        <GitMetricGrid>
          <GitMetric label="Files" value={String(snapshot.files.length)} />
          <GitMetric label="Ahead" value={String(snapshot.ahead)} />
          <GitMetric label="Behind" value={String(snapshot.behind)} />
        </GitMetricGrid>

        <GitNotice>
          <GitNoticeStrong>Local commit:</GitNoticeStrong> selected files only; no push or remote
          state is created here.
        </GitNotice>
      </GitWorkbenchHeader>

      {error ? <GitErrorBanner>{error}</GitErrorBanner> : null}

      <GitWorkbenchBody>
        <GitSection>
          <GitSectionHeader>
            <GitInlineMeta>
              <GitCheckbox
                checked={snapshot.files.length > 0 && selectedCount === snapshot.files.length}
                onCheckedChange={(checked) => setAllSelected(checked === true, snapshot.files)}
                aria-label="Select all changed files"
              />
              <span>{selectedCount} selected</span>
            </GitInlineMeta>
            <GitMutedLabel>Status</GitMutedLabel>
          </GitSectionHeader>
          <GitScrollArea>
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
              <GitEmptyPanel>Working tree clean</GitEmptyPanel>
            )}
          </GitScrollArea>
        </GitSection>

        <GitDiffSection>
          <GitSectionHeader>
            <GitWorkbenchKicker>Diff preview</GitWorkbenchKicker>
            {selectedFile ? <GitDiffPath>{selectedFile.path}</GitDiffPath> : null}
          </GitSectionHeader>
          <GitDiffPane>
            {diffLoading ? (
              <GitDiffLoading>
                <GitIconSlot state="loading">
                  <Loader2 />
                </GitIconSlot>
                Loading diff
              </GitDiffLoading>
            ) : diff ? (
              <GitDiffPre>{diff}</GitDiffPre>
            ) : (
              <GitDiffEmpty>{diffMessage ?? 'No diff selected'}</GitDiffEmpty>
            )}
          </GitDiffPane>
        </GitDiffSection>

        <GitActionStack>
          <GitActionPanel>
            <GitActionTitle>
              <GitIconSlot>
                <GitCommit />
              </GitIconSlot>
              Commit
            </GitActionTitle>
            <GitCommitTextarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              rows={2}
              placeholder="Commit message"
            />
            <GitPrimaryButton
              type="button"
              disabled={!canCommit}
              onClick={() => void handleCommit()}
            >
              {committing ? (
                <GitIconSlot state="loading">
                  <Loader2 />
                </GitIconSlot>
              ) : (
                <GitIconSlot>
                  <GitCommit />
                </GitIconSlot>
              )}
              Commit selected files
            </GitPrimaryButton>
          </GitActionPanel>

          <GitActionPanel>
            <GitActionTitle>
              <GitIconSlot>
                <GitPullRequest />
              </GitIconSlot>
              PR-ready
            </GitActionTitle>
            <GitPanelText>{prStatus.message}</GitPanelText>
            <GitSecondaryButton
              type="button"
              disabled={!prStatus.url}
              onClick={() => {
                if (prStatus.url) window.open(prStatus.url, '_blank', 'noopener,noreferrer');
              }}
            >
              <GitIconSlot>
                <GitPullRequest />
              </GitIconSlot>
              Open compare
            </GitSecondaryButton>
          </GitActionPanel>

          <GitActionPanel>
            <GitActionTitle>
              <GitIconSlot>
                <CheckCircle2 />
              </GitIconSlot>
              Checks
            </GitActionTitle>
            <GitPanelText>
              Unavailable. No real checks source is connected to this local workspace.
            </GitPanelText>
          </GitActionPanel>
        </GitActionStack>
      </GitWorkbenchBody>
    </GitWorkbenchShell>
  );
}

function GitUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <GitUnavailableShell>
      <GitIconSlot>
        <AlertCircle />
      </GitIconSlot>
      <div>
        <GitUnavailableTitle>{title}</GitUnavailableTitle>
        <GitUnavailableText>{message}</GitUnavailableText>
      </div>
    </GitUnavailableShell>
  );
}

function GitMetric({ label, value }: { label: string; value: string }) {
  return (
    <GitMetricCard>
      <GitMetricLabel>{label}</GitMetricLabel>
      <GitMetricValue>{value}</GitMetricValue>
    </GitMetricCard>
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
    <GitFileRowShell state={selected ? 'selected' : 'idle'}>
      <GitCheckbox checked={checked} onCheckedChange={onToggle} />
      <GitFileSelectButton type="button" onClick={onSelect}>
        <GitFileTextStack>
          <GitFileNameLine>
            <GitIconSlot>
              <FileText />
            </GitIconSlot>
            <GitFilePath>{file.path}</GitFilePath>
          </GitFileNameLine>
          <GitFileStatusBadge>{file.label}</GitFileStatusBadge>
        </GitFileTextStack>
      </GitFileSelectButton>
      <GitStatStack>
        <GitStatLine tone="added">
          <GitIconSlot>
            <Plus />
          </GitIconSlot>
          {formatStat(file.added)}
        </GitStatLine>
        <GitStatLine tone="deleted">
          <GitIconSlot>
            <Minus />
          </GitIconSlot>
          {formatStat(file.deleted)}
        </GitStatLine>
      </GitStatStack>
    </GitFileRowShell>
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
