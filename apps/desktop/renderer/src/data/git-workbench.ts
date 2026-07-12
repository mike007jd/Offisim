import { invokeCommand } from '@/lib/tauri-commands.js';
import type { GitFileChange, GitRepoState, GitWorkbench } from './types.js';

// Git porcelain parser: runs `git_exec` and parses status/numstat/diff output
// into the GitWorkbench view-model surfaced by useGitWorkbench. Split out of
// queries.ts so the query module holds query plumbing, not a tar/porcelain parser.

export interface CommandExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function gitErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Git workspace unavailable';
}

export function isNonGitWorkspace(result: CommandExecResult | string): boolean {
  const message = typeof result === 'string' ? result : `${result.stderr}\n${result.stdout}`;
  return (
    message.includes('not a git repository') ||
    message.includes('No workspace_root is bound') ||
    message.includes('Resolve project workspace')
  );
}

/** Map a non-git git_exec failure onto the specific state the UI must route.
 *  Precondition: `isNonGitWorkspace(result)` is true. Accepts a GitExecResult or
 *  a plain message, mirroring `isNonGitWorkspace`'s signature so the flatten
 *  logic lives in one place. The mutating Initialize action is only offered on a
 *  positive 'not a git repository' match; every other cause (unbound folder,
 *  unresolvable/missing path, or an unrecognized message) routes to a
 *  non-mutating Rebind/Bind state, so `git init` is never offered on a folder
 *  that is missing rather than merely un-initialized. */
export function classifyNonGitWorkspace(
  result: CommandExecResult | string,
): Exclude<GitRepoState, { status: 'repo' }> {
  const message = typeof result === 'string' ? result : `${result.stderr}\n${result.stdout}`;
  if (message.includes('No workspace_root is bound')) return { status: 'unbound' };
  if (message.includes('not a git repository')) return { status: 'uninitialized' };
  return { status: 'invalid-folder' };
}

/** Narrow a resolved git state to its workbench, or null when the folder is not
 *  an initialized repository. Lets change-list consumers keep reading `.changes`
 *  without repeating the `status === 'repo'` guard. */
export function workbenchOf(state: GitRepoState | null | undefined): GitWorkbench | null {
  return state?.status === 'repo' ? state.workbench : null;
}

async function runGit(projectId: string, args: string[]): Promise<CommandExecResult> {
  return invokeCommand('git_exec', { projectId, args, cwd: null });
}

async function runGh(projectId: string, args: string[]): Promise<CommandExecResult> {
  return invokeCommand('gh_exec', { projectId, args });
}

export async function stageGitFiles(projectId: string, paths: string[]) {
  return runGit(projectId, ['add', '--', ...paths]);
}

export async function commitGitChanges(projectId: string, message: string) {
  return runGit(projectId, ['commit', '-m', message]);
}

export async function switchGitBranch(projectId: string, branch: string, create: boolean) {
  return runGit(projectId, create ? ['switch', '-c', branch] : ['switch', branch]);
}

export async function pushGitBranch(projectId: string, branch: string) {
  return runGit(projectId, ['push', '-u', 'origin', branch]);
}

export async function getOriginRemote(projectId: string) {
  return runGit(projectId, ['remote', 'get-url', 'origin']);
}

export async function getGhAuthStatus(projectId: string) {
  return runGh(projectId, ['auth', 'status']);
}

export async function listPullRequests(projectId: string) {
  return runGh(projectId, ['pr', 'list']);
}

export async function getPullRequestStatus(projectId: string) {
  return runGh(projectId, ['pr', 'status']);
}

export async function viewPullRequest(projectId: string, web = false) {
  return runGh(projectId, web ? ['pr', 'view', '--web'] : ['pr', 'view']);
}

export async function createPullRequest(
  projectId: string,
  input: { title: string; body: string; base?: string; draft: boolean },
) {
  const args = ['pr', 'create', '--title', input.title, '--body', input.body];
  if (input.base) args.push('--base', input.base);
  if (input.draft) args.push('--draft');
  return runGh(projectId, args);
}

/** Initialize a git repository in the project's bound workspace folder. Routes
 *  through the already-whitelisted `git init` in the sandboxed git_exec command
 *  (git.rs), so no new Tauri command or capability is needed. */
export async function initGitRepository(projectId: string): Promise<void> {
  const result = await runGit(projectId, ['init']);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'git init failed');
  }
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

function splitUnifiedDiff(stdout: string): Map<string, string> {
  const files = new Map<string, string>();
  let path = '';
  let lines: string[] = [];
  const flush = () => {
    if (path) files.set(path, lines.join('\n'));
  };
  for (const line of stdout.split('\n')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (match) {
      flush();
      path = match[2] ?? match[1] ?? '';
      lines = [line];
    } else if (path) {
      lines.push(line);
    }
  }
  flush();
  return files;
}

export async function loadGitWorkbench(projectId: string): Promise<GitRepoState> {
  const status = await runGit(projectId, ['status', '--porcelain=v1', '--branch']);
  if (!status.ok) {
    if (isNonGitWorkspace(status)) return classifyNonGitWorkspace(status);
    throw new Error(status.stderr.trim() || status.stdout.trim() || 'Git status failed');
  }

  const statusLines = status.stdout.split('\n').filter(Boolean);
  const branch = parseBranch(statusLines.find((line) => line.startsWith('## ')));
  const changes = statusLines
    .map(parseStatusLine)
    .filter((row): row is GitFileChange => Boolean(row));
  const [unstagedStats, stagedStats, diffPreview, stagedDiff] = await Promise.all([
    runGit(projectId, ['diff', '--numstat']),
    runGit(projectId, ['diff', '--cached', '--numstat']),
    runGit(projectId, ['diff', '--unified=2']),
    runGit(projectId, ['diff', '--cached', '--unified=3']),
  ]);
  const stats = new Map([
    ...parseNumstat(unstagedStats.ok ? unstagedStats.stdout : ''),
    ...parseNumstat(stagedStats.ok ? stagedStats.stdout : ''),
  ]);
  const unstagedByPath = splitUnifiedDiff(diffPreview.ok ? diffPreview.stdout : '');
  const stagedByPath = splitUnifiedDiff(stagedDiff.ok ? stagedDiff.stdout : '');
  const diffFiles = changes.map((change) => ({
    path: change.path,
    diff: [stagedByPath.get(change.path), unstagedByPath.get(change.path)]
      .filter((value): value is string => Boolean(value))
      .join('\n'),
  }));

  return {
    status: 'repo',
    workbench: {
      ...branch,
      changes: changes.map((change) => ({ ...change, ...(stats.get(change.path) ?? {}) })),
      diffPreview: parseDiffPreview(diffPreview.ok ? diffPreview.stdout : ''),
      diffFiles,
      checks: [
        {
          id: 'git-status',
          label: changes.length === 0 ? 'clean tree' : 'local changes',
          state: changes.length === 0 ? 'pass' : 'running',
        },
      ],
    },
  };
}
