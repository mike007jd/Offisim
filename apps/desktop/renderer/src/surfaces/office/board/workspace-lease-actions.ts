import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { createTauriGitWorktreeOps } from '@/runtime/mission/workspace/git-worktree-ops.js';
import { getRepos } from '@/runtime/repos.js';
import { type WorkspaceLease, createWorkspaceLeaseManager } from '@offisim/core/browser';
import {
  type WorkspaceLeaseReviewRow,
  buildProjectWorkspaceLeaseReviewRows,
} from './task-board-data.js';

export type WorkspaceLeaseReviewOutcome = 'merged' | 'discarded' | 'host_resolved';

const WORKSPACE_LEASE_REVIEW_TITLE_PREFIX = 'Review delegated work ';
const leaseDecisionById = new Map<string, Promise<WorkspaceLeaseReviewOutcome>>();

export function workspaceLeaseIdFromApprovalTitle(title: string): string | null {
  if (!title.startsWith(WORKSPACE_LEASE_REVIEW_TITLE_PREFIX)) return null;
  const leaseId = title.slice(WORKSPACE_LEASE_REVIEW_TITLE_PREFIX.length).trim();
  return leaseId && !/\s/u.test(leaseId) ? leaseId : null;
}

async function waitForConversationTerminal(threadId: string, attemptId: string): Promise<void> {
  const terminalPhases = new Set(['completed', 'failed', 'interrupted']);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = () => {
      const snapshot = conversationRunController.getSnapshot(threadId);
      if (snapshot.attemptId !== attemptId || !terminalPhases.has(snapshot.phase)) return;
      if (snapshot.phase === 'failed') {
        finish(new Error(snapshot.error?.message || 'The delegated review run failed.'));
        return;
      }
      finish();
    };
    const timer = setTimeout(
      () => finish(new Error('Timed out waiting for the delegated review decision to finish.')),
      60_000,
    );
    unsubscribe = conversationRunController.subscribe(threadId, inspect);
    inspect();
  });
}

async function persistedLeaseStatus(
  row: WorkspaceLeaseReviewRow,
): Promise<WorkspaceLeaseReviewRow['status'] | null> {
  if (!row.projectId) return null;
  const repos = await getRepos();
  if (!repos.agentEvents) return null;
  const [snapshots, actions] = await Promise.all([
    repos.agentEvents.findByProject(row.projectId, { eventType: 'workspace.lease.snapshot' }),
    repos.agentEvents.findByProject(row.projectId, { eventType: 'workspace.lease.action' }),
  ]);
  return (
    buildProjectWorkspaceLeaseReviewRows([...snapshots, ...actions]).find(
      (lease) => lease.leaseId === row.leaseId,
    )?.status ?? null
  );
}

function toLease(row: WorkspaceLeaseReviewRow): WorkspaceLease {
  if (!row.workspaceRoot || !row.cwd || !row.branch) {
    throw new Error('The lease is missing its workspace, cwd, or branch.');
  }
  return {
    leaseId: row.leaseId,
    runId: row.runId,
    workspaceRoot: row.workspaceRoot,
    access: 'write',
    cwd: row.cwd,
    branch: row.branch,
    isolated: true,
    status: 'pending_review',
    reason: row.reason ?? undefined,
    createdAt: row.createdAt,
  };
}

function managerFor(row: WorkspaceLeaseReviewRow) {
  if (!row.projectId) throw new Error('The lease has no project binding.');
  const manager = createWorkspaceLeaseManager({
    gitOps: createTauriGitWorktreeOps({ projectId: row.projectId }),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  });
  return { manager, lease: manager.adoptLease(toLease(row)) };
}

async function mergeWorkspaceLease(row: WorkspaceLeaseReviewRow): Promise<void> {
  const { manager, lease } = managerFor(row);
  const plan = await manager.planIntegration([lease]);
  const result = await manager.integrate(plan);
  if (result.conflicted || result.merged.length !== 1) {
    throw new Error(
      result.conflicted
        ? `Merge conflict: ${result.conflicted.conflicts.join(', ')}`
        : result.skipped[0]?.reason || 'Lease was not mergeable.',
    );
  }
  await manager.releaseLease(lease.leaseId);
}

async function discardWorkspaceLease(row: WorkspaceLeaseReviewRow): Promise<void> {
  const { manager, lease } = managerFor(row);
  await manager.releaseLease(lease.leaseId, { discard: true });
}

function resumeLeasePacket(row: WorkspaceLeaseReviewRow) {
  const lease = toLease(row);
  return {
    leaseId: lease.leaseId,
    runId: lease.runId,
    workspaceRoot: lease.workspaceRoot,
    cwd: lease.cwd,
    branch: lease.branch as string,
    createdAt: lease.createdAt,
  };
}

export async function appendWorkspaceLeaseAction(
  row: WorkspaceLeaseReviewRow,
  companyId: string,
  action: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const repos = await getRepos();
  await repos.agentEvents?.append({
    event_id: crypto.randomUUID(),
    project_id: row.projectId,
    thread_id: row.threadId,
    company_id: companyId,
    agent_name: 'workspace-lease-review',
    event_type: 'workspace.lease.action',
    payload_json: JSON.stringify({
      leaseId: row.leaseId,
      rootRunId: row.rootRunId,
      runId: row.runId,
      action,
      status,
      createdAt: new Date().toISOString(),
      ...extra,
    }),
    parent_event_id: null,
  });
}

async function resolveWorkspaceLeaseReview(
  row: WorkspaceLeaseReviewRow,
  companyId: string,
  action: 'merge' | 'discard',
): Promise<WorkspaceLeaseReviewOutcome> {
  const persisted = await persistedLeaseStatus(row);
  if (persisted === 'merged' || persisted === 'discarded') return persisted;

  const approval = conversationRunController.getSnapshot(row.threadId).approval;
  const live =
    approval?.state === 'live' && approval.title === `Review delegated work ${row.leaseId}`;
  if (live) {
    await conversationRunController.answerApproval({
      threadId: approval.threadId,
      attemptId: approval.attemptId,
      hostRequestId: approval.hostRequestId,
      uiRequestId: approval.uiRequestId,
      confirmed: action === 'merge',
    });
    await waitForConversationTerminal(approval.threadId, approval.attemptId);
    if (action === 'merge') {
      const status = await persistedLeaseStatus(row);
      if (status === 'failed') throw new Error('The delegated work could not be merged.');
      return status === 'merged' ? 'merged' : 'host_resolved';
    }
  }
  if (action === 'merge') await mergeWorkspaceLease(row);
  if (action === 'discard') await discardWorkspaceLease(row);
  await appendWorkspaceLeaseAction(
    row,
    companyId,
    action === 'merge' ? 'merge_completed' : 'discard_completed',
    action === 'merge' ? 'merged' : 'discarded',
  );
  return action === 'merge' ? 'merged' : 'discarded';
}

export function reviewWorkspaceLease(
  row: WorkspaceLeaseReviewRow,
  companyId: string,
  action: 'merge' | 'discard',
): Promise<WorkspaceLeaseReviewOutcome> {
  const active = leaseDecisionById.get(row.leaseId);
  if (active) return active;
  const decision = resolveWorkspaceLeaseReview(row, companyId, action).finally(() => {
    if (leaseDecisionById.get(row.leaseId) === decision) leaseDecisionById.delete(row.leaseId);
  });
  leaseDecisionById.set(row.leaseId, decision);
  return decision;
}

export async function requestWorkspaceLeaseChanges(
  row: WorkspaceLeaseReviewRow,
  input: {
    companyId: string;
    projectId: string;
    employeeId: string;
    objective: string;
    feedback: string;
  },
): Promise<void> {
  const approval = conversationRunController.getSnapshot(row.threadId).approval;
  if (approval?.state === 'live' && approval.title === `Review delegated work ${row.leaseId}`) {
    await conversationRunController.answerApproval({
      threadId: approval.threadId,
      attemptId: approval.attemptId,
      hostRequestId: approval.hostRequestId,
      uiRequestId: approval.uiRequestId,
      confirmed: false,
    });
    await waitForConversationTerminal(approval.threadId, approval.attemptId);
  }
  const repos = await getRepos();
  const threadId = `thread-${crypto.randomUUID()}`;
  await repos.chatThreads.create({
    thread_id: threadId,
    project_id: input.projectId,
    employee_id: null,
    title: 'Task Board rework',
  });
  const objective = `${input.objective}\n\nReview feedback:\n${input.feedback}\n\nContinue in the existing worktree and address every point.`;
  const handle = await conversationRunController.submit({
    companyId: input.companyId,
    projectId: input.projectId,
    threadId,
    employeeId: null,
    text: objective,
    stagedAttachments: [],
    source: 'workspace',
    directDelegation: {
      employeeId: input.employeeId,
      objective,
      access: 'write',
      workKind: 'implement',
      originRunId: row.runId,
      resumeLease: resumeLeasePacket(row),
    },
  });
  await appendWorkspaceLeaseAction(row, input.companyId, 'changes_requested', 'active', {
    feedback: input.feedback,
    originRunId: row.runId,
    reworkRootRunId: handle.attemptId,
  });
}
