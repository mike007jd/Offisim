import type { GitFileChange, GitWorkbench } from './types.js';

// Git porcelain parser: runs `git_exec` and parses status/numstat/diff output
// into the GitWorkbench view-model surfaced by useGitWorkbench. Split out of
// queries.ts so the query module holds query plumbing, not a tar/porcelain parser.

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function gitErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Git workspace unavailable';
}

export function isNonGitWorkspace(result: GitExecResult | string): boolean {
  const message = typeof result === 'string' ? result : `${result.stderr}\n${result.stdout}`;
  return (
    message.includes('not a git repository') ||
    message.includes('No workspace_root is bound') ||
    message.includes('Resolve project workspace')
  );
}

async function runGit(projectId: string, args: string[]): Promise<GitExecResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<GitExecResult>('git_exec', { projectId, args, cwd: null });
}

function parseStatusLine(rawLine: string): GitFileChange | null {
  if (!rawLine || rawLine.startsWith('##')) return null;
  const x = rawLine[0] ?? ' ';
  const y = rawLine[1] ?? ' ';
  const pathPart = rawLine.slice(3).trim();
  if (!pathPart) return null;
  const statusCode = x === ' ' || x === '?' ? y : x;
  const status: GitFileChange['status'] =
    statusCode === 'A' || statusCode === '?'
      ? 'added'
      : statusCode === 'D'
        ? 'deleted'
        : statusCode === 'R'
          ? 'renamed'
          : 'modified';
  const path = status === 'renamed' ? (pathPart.split(' -> ').at(-1) ?? pathPart) : pathPart;
  return {
    path,
    status,
    staged: x !== ' ' && x !== '?',
    added: 0,
    removed: 0,
  };
}

function parseBranch(
  statusHeader: string | undefined,
): Pick<GitWorkbench, 'branch' | 'ahead' | 'behind'> {
  if (!statusHeader?.startsWith('## ')) return { branch: 'detached', ahead: 0, behind: 0 };
  const value = statusHeader.slice(3).trim();
  const branch = value.split('...')[0]?.replace('No commits yet on ', '').trim() || 'detached';
  const ahead = Number(value.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(value.match(/behind (\d+)/)?.[1] ?? 0);
  return { branch, ahead, behind };
}

function parseNumstat(stdout: string): Map<string, Pick<GitFileChange, 'added' | 'removed'>> {
  const stats = new Map<string, Pick<GitFileChange, 'added' | 'removed'>>();
  for (const line of stdout.split('\n')) {
    const [addedRaw, removedRaw, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t').trim();
    if (!path) continue;
    const added = Number.parseInt(addedRaw ?? '0', 10);
    const removed = Number.parseInt(removedRaw ?? '0', 10);
    stats.set(path, {
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
    });
  }
  return stats;
}

function parseDiffPreview(stdout: string): GitWorkbench['diffPreview'] {
  return stdout
    .split('\n')
    .filter((line) => line && !line.startsWith('diff --git') && !line.startsWith('index '))
    .slice(0, 80)
    .map((line) => ({
      kind:
        line.startsWith('+') && !line.startsWith('+++')
          ? 'add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'remove'
            : 'context',
      text: line.replace(/^[+-]/, ''),
    }));
}

export async function loadGitWorkbench(projectId: string): Promise<GitWorkbench | null> {
  const status = await runGit(projectId, ['status', '--porcelain=v1', '--branch']);
  if (!status.ok) {
    if (isNonGitWorkspace(status)) return null;
    throw new Error(status.stderr.trim() || status.stdout.trim() || 'Git status failed');
  }

  const statusLines = status.stdout.split('\n').filter(Boolean);
  const branch = parseBranch(statusLines.find((line) => line.startsWith('## ')));
  const changes = statusLines
    .map(parseStatusLine)
    .filter((row): row is GitFileChange => Boolean(row));
  const [unstagedStats, stagedStats, diffPreview] = await Promise.all([
    runGit(projectId, ['diff', '--numstat']),
    runGit(projectId, ['diff', '--cached', '--numstat']),
    runGit(projectId, ['diff', '--unified=2']),
  ]);
  const stats = new Map([
    ...parseNumstat(unstagedStats.ok ? unstagedStats.stdout : ''),
    ...parseNumstat(stagedStats.ok ? stagedStats.stdout : ''),
  ]);

  return {
    ...branch,
    changes: changes.map((change) => ({ ...change, ...(stats.get(change.path) ?? {}) })),
    diffPreview: parseDiffPreview(diffPreview.ok ? diffPreview.stdout : ''),
    checks: [
      {
        id: 'git-status',
        label: changes.length === 0 ? 'clean tree' : 'local changes',
        state: changes.length === 0 ? 'pass' : 'running',
      },
    ],
  };
}
