import type { RuntimeRepositories } from '../runtime/repositories.js';
import { generateId } from '../utils/generate-id.js';

export interface WorkspaceSnapshot {
  workspaceRoot: string;
  isGitRepository: boolean;
  gitHead: string | null;
  statusHash: string | null;
  dirty: boolean;
  statusLines: number;
  capturedAt: string;
}

export interface WorkspaceStalenessResult {
  status: 'clean' | 'warn' | 'block' | 'unavailable';
  reason:
    | 'baseline_matches'
    | 'git_worktree_changed'
    | 'git_head_changed'
    | 'missing_workspace_root'
    | 'missing_baseline'
    | 'not_git_repository'
    | 'capture_failed';
  baseline?: WorkspaceSnapshot | null;
  current?: WorkspaceSnapshot | null;
}

type SnapshotProbe = (workspaceRoot: string) => Promise<WorkspaceSnapshot | null>;

interface WorkspaceSnapshotCheckpointPayload {
  version: 1;
  snapshot: WorkspaceSnapshot;
}

export class WorkspaceStalenessService {
  constructor(
    private readonly repos: RuntimeRepositories,
    private readonly probe: SnapshotProbe = captureWorkspaceSnapshot,
  ) {}

  async saveThreadBaseline(threadId: string, companyId: string) {
    const company = await this.repos.companies.findById(companyId);
    if (!company?.workspace_root) return null;

    const snapshot = await this.probe(company.workspace_root);
    if (!snapshot) return null;

    const latest = await this.repos.checkpoints.findLatest(threadId);
    const checkpointSeq = (latest?.checkpoint_seq ?? 0) + 1;
    const checkpoint = {
      checkpoint_id: generateId('cp'),
      thread_id: threadId,
      checkpoint_seq: checkpointSeq,
      checkpoint_kind: 'workspace_snapshot',
      payload_json: JSON.stringify({
        version: 1,
        snapshot,
      } satisfies WorkspaceSnapshotCheckpointPayload),
      created_at: snapshot.capturedAt,
    };
    await this.repos.checkpoints.save(checkpoint);
    return checkpoint;
  }

  async checkThread(threadId: string, companyId: string): Promise<WorkspaceStalenessResult> {
    const company = await this.repos.companies.findById(companyId);
    if (!company?.workspace_root) {
      return { status: 'unavailable', reason: 'missing_workspace_root' };
    }

    const baseline = await this.findLatestWorkspaceSnapshot(threadId);
    if (!baseline) {
      return { status: 'unavailable', reason: 'missing_baseline' };
    }

    const current = await this.probe(company.workspace_root);
    if (!current) {
      return { status: 'unavailable', reason: 'capture_failed', baseline, current: null };
    }

    if (!current.isGitRepository || !baseline.isGitRepository) {
      return { status: 'unavailable', reason: 'not_git_repository', baseline, current };
    }

    if (baseline.gitHead !== current.gitHead) {
      return { status: 'block', reason: 'git_head_changed', baseline, current };
    }

    if (
      baseline.statusHash !== current.statusHash ||
      baseline.dirty !== current.dirty ||
      baseline.statusLines !== current.statusLines
    ) {
      return { status: 'warn', reason: 'git_worktree_changed', baseline, current };
    }

    return { status: 'clean', reason: 'baseline_matches', baseline, current };
  }

  private async findLatestWorkspaceSnapshot(threadId: string): Promise<WorkspaceSnapshot | null> {
    const latest = await this.repos.checkpoints.findLatest(threadId);
    if (!latest || latest.checkpoint_kind !== 'workspace_snapshot') return null;
    try {
      const parsed = JSON.parse(latest.payload_json) as Partial<WorkspaceSnapshotCheckpointPayload>;
      const snapshot = parsed.snapshot;
      if (
        parsed.version !== 1 ||
        !snapshot ||
        typeof snapshot.workspaceRoot !== 'string' ||
        typeof snapshot.isGitRepository !== 'boolean' ||
        typeof snapshot.dirty !== 'boolean' ||
        typeof snapshot.statusLines !== 'number' ||
        typeof snapshot.capturedAt !== 'string'
      ) {
        return null;
      }
      return {
        workspaceRoot: snapshot.workspaceRoot,
        isGitRepository: snapshot.isGitRepository,
        gitHead: snapshot.gitHead ?? null,
        statusHash: snapshot.statusHash ?? null,
        dirty: snapshot.dirty,
        statusLines: snapshot.statusLines,
        capturedAt: snapshot.capturedAt,
      };
    } catch {
      return null;
    }
  }
}

async function captureWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot | null> {
  const head = await runGit(workspaceRoot, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return {
      workspaceRoot,
      isGitRepository: false,
      gitHead: null,
      statusHash: null,
      dirty: false,
      statusLines: 0,
      capturedAt: new Date().toISOString(),
    };
  }

  const status = await runGit(workspaceRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=normal',
  ]);
  if (!status.ok) return null;
  const normalized = status.stdout.trim();
  return {
    workspaceRoot,
    isGitRepository: true,
    gitHead: head.stdout.trim() || null,
    statusHash: hashText(normalized),
    dirty: normalized.length > 0,
    statusLines: normalized.length > 0 ? normalized.split('\n').length : 0,
    capturedAt: new Date().toISOString(),
  };
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const childProcess = await import('node:child_process');
    return await new Promise((resolve) => {
      childProcess.execFile('git', args, { cwd }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? error.message ?? ''),
          });
          return;
        }
        resolve({
          ok: true,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      });
    });
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
