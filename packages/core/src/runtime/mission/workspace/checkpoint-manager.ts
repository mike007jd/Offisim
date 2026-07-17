import type {
  GitWorktreeOps,
  WorkspaceCheckpoint,
  WorkspaceCheckpointRollback,
  WorkspaceLease,
} from './types.js';

export interface WorkspaceCheckpointManagerDeps {
  gitOps: GitWorktreeOps;
  now: () => string;
}

export interface WorkspaceCheckpointTrigger {
  toolName: string;
  toolCallId?: string | null;
}

export interface WorkspaceCheckpointManager {
  open(lease: WorkspaceLease): Promise<WorkspaceCheckpoint[]>;
  captureAfterTool(
    lease: WorkspaceLease,
    trigger: WorkspaceCheckpointTrigger,
  ): Promise<WorkspaceCheckpoint | null>;
  list(lease: WorkspaceLease): Promise<WorkspaceCheckpoint[]>;
  rewind(
    lease: WorkspaceLease,
    checkpoint: WorkspaceCheckpoint,
    actor: string,
  ): Promise<WorkspaceCheckpointRollback>;
  waitForIdle(leaseId: string): Promise<void>;
}

const MUTATING_TOOL_TOKENS = new Set([
  'bash',
  'edit',
  'patch',
  'replace',
  'write',
  'create',
  'save',
  'append',
]);

export function isCheckpointCandidateTool(toolName: string): boolean {
  const tokens = toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => MUTATING_TOOL_TOKENS.has(token));
}

function requireIsolatedWriteLease(lease: WorkspaceLease): void {
  if (!lease.isolated || lease.access !== 'write') {
    throw new Error('Workspace checkpoints require an isolated writable lease.');
  }
}

export function createWorkspaceCheckpointManager(
  deps: WorkspaceCheckpointManagerDeps,
): WorkspaceCheckpointManager {
  const { gitOps, now } = deps;
  const tails = new Map<string, Promise<unknown>>();

  const create = gitOps.createCheckpoint?.bind(gitOps);
  const listCheckpoints = gitOps.listCheckpoints?.bind(gitOps);
  const rollback = gitOps.rollbackCheckpoint?.bind(gitOps);

  function requireReadOps(): void {
    if (!create || !listCheckpoints) {
      throw new Error('The git checkpoint capability is unavailable.');
    }
  }

  function serial<T>(leaseId: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(leaseId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    tails.set(leaseId, current);
    void current
      .finally(() => {
        if (tails.get(leaseId) === current) tails.delete(leaseId);
      })
      .catch(() => undefined);
    return current;
  }

  async function list(lease: WorkspaceLease): Promise<WorkspaceCheckpoint[]> {
    requireIsolatedWriteLease(lease);
    requireReadOps();
    const checkpoints = await listCheckpoints!(lease.cwd, lease.leaseId);
    return [...checkpoints].sort((a, b) => a.step - b.step);
  }

  async function open(lease: WorkspaceLease): Promise<WorkspaceCheckpoint[]> {
    return serial(lease.leaseId, async () => {
      const recovered = await list(lease);
      if (recovered.length > 0) return recovered;
      const baseline = await create!(lease.cwd, {
        leaseId: lease.leaseId,
        runId: lease.runId,
        triggerTool: 'run.started',
        triggerToolCallId: null,
        createdAt: now(),
      });
      return baseline ? [baseline] : [];
    });
  }

  async function captureAfterTool(
    lease: WorkspaceLease,
    trigger: WorkspaceCheckpointTrigger,
  ): Promise<WorkspaceCheckpoint | null> {
    if (!isCheckpointCandidateTool(trigger.toolName)) return null;
    return serial(lease.leaseId, async () => {
      requireIsolatedWriteLease(lease);
      requireReadOps();
      return create!(lease.cwd, {
        leaseId: lease.leaseId,
        runId: lease.runId,
        triggerTool: trigger.toolName,
        triggerToolCallId: trigger.toolCallId ?? null,
        createdAt: now(),
      });
    });
  }

  async function rewind(
    lease: WorkspaceLease,
    checkpoint: WorkspaceCheckpoint,
    actor: string,
  ): Promise<WorkspaceCheckpointRollback> {
    return serial(lease.leaseId, async () => {
      requireIsolatedWriteLease(lease);
      if (!rollback) throw new Error('The git checkpoint rewind capability is unavailable.');
      if (checkpoint.leaseId !== lease.leaseId) {
        throw new Error('Checkpoint belongs to another workspace lease.');
      }
      const normalizedActor = actor.trim();
      if (!normalizedActor) throw new Error('Checkpoint rewind requires an actor.');
      return rollback!(lease.cwd, checkpoint, normalizedActor);
    });
  }

  return {
    open,
    captureAfterTool,
    list,
    rewind,
    waitForIdle: async (leaseId) => {
      await (tails.get(leaseId) ?? Promise.resolve()).catch(() => undefined);
    },
  };
}
