import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import type { ReviewAnnotation, ReviewWorkbenchState } from '@/data/review-workbench.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { createTauriGitWorktreeOps } from '@/runtime/mission/workspace/git-worktree-ops.js';
import { getRepos } from '@/runtime/repos.js';
import { type WorkspaceLease, createWorkspaceLeaseManager } from '@offisim/core/browser';
import {
  type WorkspaceLeaseReviewRow,
  workspaceLeaseStatusFromLifecycle,
} from './task-board-data.js';
import {
  type WorkspaceLeaseDecisionAction,
  WorkspaceLeaseDecisionCoordinator,
} from './workspace-lease-decision-coordinator.js';

export type WorkspaceLeaseReviewOutcome = 'merged' | 'discarded' | 'host_resolved';

const WORKSPACE_LEASE_REVIEW_TITLE_PREFIX = 'Review delegated work ';
const leaseDecisionById = new WorkspaceLeaseDecisionCoordinator<WorkspaceLeaseReviewOutcome>();

export const subscribeWorkspaceLeaseDecisions = leaseDecisionById.subscribe;
export const workspaceLeaseDecisionVersion = leaseDecisionById.getVersion;

export function workspaceLeaseDecisionAction(leaseId: string): WorkspaceLeaseDecisionAction | null {
  return leaseDecisionById.actionFor(leaseId);
}

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
  const lifecycle = (
    await invokeCommand('workspace_lease_list', { projectId: row.projectId })
  ).find((lease) => lease.leaseId === row.leaseId);
  return lifecycle ? workspaceLeaseStatusFromLifecycle(lifecycle) : null;
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
  await repos.agentEvents.append({
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
  if (persisted === 'failed') {
    throw new Error('The retained worktree is invalid and cannot be reviewed.');
  }
  if (!persisted) {
    throw new Error('The retained worktree is no longer registered for this Project.');
  }

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
    const status = await persistedLeaseStatus(row);
    if (status === 'merged' || status === 'discarded') return status;
    if (status === 'failed') throw new Error('The delegated work could not be resolved.');
    if (action === 'merge') return 'host_resolved';
  }
  if (action === 'merge') await mergeWorkspaceLease(row);
  if (action === 'discard') await discardWorkspaceLease(row);
  const outcome = action === 'merge' ? 'merged' : 'discarded';
  try {
    await appendWorkspaceLeaseAction(
      row,
      companyId,
      action === 'merge' ? 'merge_completed' : 'discard_completed',
      outcome,
    );
  } catch (eventError) {
    // The lifecycle row is the terminal oracle. If cleanup committed but the
    // enrichment event failed, report the durable outcome and never replay the
    // destructive Git operation. A failed lifecycle read/mismatch still throws.
    if ((await persistedLeaseStatus(row)) !== outcome) throw eventError;
  }
  return outcome;
}

export function reviewWorkspaceLease(
  row: WorkspaceLeaseReviewRow,
  companyId: string,
  action: 'merge' | 'discard',
): Promise<WorkspaceLeaseReviewOutcome> {
  return leaseDecisionById.run(row.leaseId, action, () =>
    resolveWorkspaceLeaseReview(row, companyId, action),
  );
}

export async function requestWorkspaceLeaseChanges(
  row: WorkspaceLeaseReviewRow,
  input: {
    companyId: string;
    projectId: string;
    employeeId: string;
    objective: string;
    feedback: string;
    review?: ReviewWorkbenchState;
    annotations?: ReviewAnnotation[];
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
  const objective = `${input.objective}\n\nResume the existing worktree. A structured review steer follows immediately; address every point before returning the lease for review.`;
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
  const reviewBatchId = crypto.randomUUID();
  const annotations = input.annotations ?? [];
  const reviewPoints =
    annotations.length > 0
      ? annotations.map(
          (annotation, index) =>
            `${index + 1}. ${annotation.path} · ${annotation.label}\n   ${annotation.body}`,
        )
      : [input.feedback];
  const steerText = [
    `Review steer ${reviewBatchId}`,
    `Employee: ${input.employeeId}`,
    `Lease: ${row.leaseId}`,
    '',
    ...reviewPoints,
    '',
    'Continue in the existing worktree, address every review annotation, run the relevant checks, and return the lease for review.',
  ].join('\n');
  try {
    const control = await conversationRunController.enqueue(
      {
        companyId: input.companyId,
        projectId: input.projectId,
        threadId,
        employeeId: null,
        text: steerText,
        stagedAttachments: [],
        source: 'workspace',
      },
      'steer',
    );
    await appendWorkspaceLeaseAction(row, input.companyId, 'review_steered', 'active', {
      feedback: input.feedback,
      ...(input.review ? { review: input.review } : {}),
      reviewBatchId,
      commentIds: annotations.map((annotation) => annotation.id),
      controlMessageId: control.userMessageId,
      originRunId: row.runId,
      reworkRootRunId: handle.attemptId,
    });
  } catch (error) {
    await conversationRunController.stopAndWait(threadId);
    const failedCommentIds = new Set(annotations.map((annotation) => annotation.id));
    const retryableReview = input.review
      ? {
          ...input.review,
          annotations: input.review.annotations.map((annotation) =>
            failedCommentIds.has(annotation.id) && annotation.state === 'submitted'
              ? { ...annotation, state: 'draft' as const }
              : annotation,
          ),
        }
      : undefined;
    await appendWorkspaceLeaseAction(row, input.companyId, 'review_steer_error', 'pending_review', {
      ...(retryableReview ? { review: retryableReview } : {}),
      reviewBatchId,
      originRunId: row.runId,
      reworkRootRunId: handle.attemptId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function persistWorkspaceLeaseReview(
  row: WorkspaceLeaseReviewRow,
  companyId: string,
  review: ReviewWorkbenchState,
): Promise<void> {
  await appendWorkspaceLeaseAction(row, companyId, 'review_updated', 'pending_review', {
    review,
  });
}

export async function applyWorkspaceLeaseReviewPatch(
  row: WorkspaceLeaseReviewRow,
  patch: string,
): Promise<void> {
  if (!row.projectId || !row.cwd) throw new Error('The lease has no Project or worktree path.');
  await invokeCommand('workspace_lease_apply_patch', {
    projectId: row.projectId,
    leaseId: row.leaseId,
    path: row.cwd,
    patch,
    reverse: true,
  });
}
