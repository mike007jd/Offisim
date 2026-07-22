import type { WorkspaceCheckpointRow } from '@/lib/tauri-commands.js';
import { createTauriGitWorktreeOps } from '@/runtime/mission/workspace/git-worktree-ops.js';
import { getRepos, runtimeEventBus } from '@/runtime/repos.js';
import {
  type WorkspaceLease,
  createWorkspaceCheckpointManager,
  engineActivity,
} from '@offisim/core/browser';

function leaseFor(checkpoint: WorkspaceCheckpointRow): WorkspaceLease {
  return {
    leaseId: checkpoint.leaseId,
    runId: checkpoint.runId,
    workspaceRoot: checkpoint.workspaceRoot,
    access: 'write',
    cwd: checkpoint.cwd,
    branch: checkpoint.branch,
    isolated: true,
    status: 'active',
    createdAt: checkpoint.createdAt,
  };
}

export async function rewindWorkspaceCheckpoint(
  checkpoint: WorkspaceCheckpointRow,
  companyId: string,
  actor = 'You',
): Promise<void> {
  const manager = createWorkspaceCheckpointManager({
    gitOps: createTauriGitWorktreeOps({ projectId: checkpoint.projectId }),
    now: () => new Date().toISOString(),
  });
  const rollback = await manager.rewind(leaseFor(checkpoint), checkpoint, actor);
  try {
    const repos = await getRepos();
    await repos.agentEvents.append({
      event_id: rollback.rollbackId,
      project_id: checkpoint.projectId,
      thread_id: checkpoint.threadId ?? checkpoint.rootRunId,
      company_id: companyId,
      agent_name: actor,
      event_type: 'workspace.checkpoint.rollback',
      payload_json: JSON.stringify({
        ...rollback,
        runId: checkpoint.runId,
        rootRunId: checkpoint.rootRunId,
        workspaceRoot: checkpoint.workspaceRoot,
        cwd: checkpoint.cwd,
        branch: checkpoint.branch,
      }),
      parent_event_id: null,
    });
  } catch (error) {
    console.warn('[workspace-checkpoint] rollback projection failed after durable rewind', {
      rollbackId: rollback.rollbackId,
      error,
    });
  }
  runtimeEventBus.emit(
    engineActivity(companyId, checkpoint.threadId ?? checkpoint.rootRunId, {
      runId: checkpoint.runId,
      engineId: 'offisim-engine',
      employeeId: actor,
      employeeName: actor,
      taskRunId: checkpoint.rootRunId,
      kind: 'rollback',
      status: 'rolled_back',
      activityId: rollback.rollbackId,
      label: `Workspace rolled back to Step ${checkpoint.step}`,
      detail: `${rollback.changedPaths.length} file${rollback.changedPaths.length === 1 ? '' : 's'} restored`,
    }),
  );
}
