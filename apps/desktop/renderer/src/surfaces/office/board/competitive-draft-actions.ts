import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import type { WorkspaceLeaseReviewRow } from '@/data/board/task-board-data.js';
import { distillCompetitiveDraftLoserMemory } from '@/runtime/employee-project-memory.js';
import { getRepos } from '@/runtime/repos.js';
import type { CompetitiveDraftAttemptRow, CompetitiveDraftGroupRow } from '@offisim/core/browser';
import { reviewWorkspaceLease } from './workspace-lease-actions.js';

export interface StartCompetitiveDraftInput {
  companyId: string;
  projectId: string;
  sourceRunId: string;
  objective: string;
  employeeIds: readonly string[];
}

export interface CompetitiveDraftLaunchResult {
  groupId: string;
  attemptIds: string[];
  launchedCount: number;
  failedCount: number;
}

function uniqueAssignees(employeeIds: readonly string[]): string[] {
  return [...new Set(employeeIds.map((id) => id.trim()).filter(Boolean))];
}

export async function startCompetitiveDraft(
  input: StartCompetitiveDraftInput,
): Promise<CompetitiveDraftLaunchResult> {
  const employeeIds = uniqueAssignees(input.employeeIds);
  if (employeeIds.length < 2 || employeeIds.length > 4) {
    throw new Error('Competitive drafting requires 2–4 distinct employees.');
  }
  const objective = input.objective.trim();
  if (!objective) throw new Error('Competitive drafting requires a request objective.');

  const repos = await getRepos();
  const activeGroup = await repos.competitiveDraftGroups.findBySourceRun(input.sourceRunId);
  if (
    activeGroup &&
    (activeGroup.status === 'drafting' ||
      activeGroup.status === 'reviewing' ||
      activeGroup.status === 'merging' ||
      Boolean(activeGroup.winner_attempt_id))
  ) {
    throw new Error('This request already has a competitive draft in progress.');
  }
  const now = new Date().toISOString();
  const groupId = `draft-group-${crypto.randomUUID()}`;
  const records = employeeIds.map((employeeId, index) => ({
    attemptId: `draft-attempt-${crypto.randomUUID()}`,
    runId: `attempt-${crypto.randomUUID()}`,
    threadId: `thread-${crypto.randomUUID()}`,
    employeeId,
    ordinal: index + 1,
  }));

  await repos.asyncTransact(async (transactionRepos) => {
    if (!transactionRepos) {
      throw new Error('Competitive drafting requires transaction-scoped repositories.');
    }
    await transactionRepos.competitiveDraftGroups.create({
      group_id: groupId,
      company_id: input.companyId,
      project_id: input.projectId,
      source_run_id: input.sourceRunId,
      objective,
      status: 'drafting',
      created_at: now,
      updated_at: now,
    });
    for (const record of records) {
      await transactionRepos.chatThreads.create({
        thread_id: record.threadId,
        project_id: input.projectId,
        employee_id: record.employeeId,
        title: `Competitive draft · Option ${record.ordinal}`,
      });
      await transactionRepos.competitiveDraftAttempts.create({
        attempt_id: record.attemptId,
        group_id: groupId,
        ordinal: record.ordinal,
        employee_id: record.employeeId,
        thread_id: record.threadId,
        run_id: record.runId,
        status: 'planned',
        started_at: now,
      });
    }
  });

  const delegationLimits = {
    maxDepth: 1,
    maxParallelPerDelegation: records.length,
    maxTotalChildren: records.length,
  } as const;
  const launches = await Promise.allSettled(
    records.map(async (record) => {
      try {
        await repos.competitiveDraftAttempts.update(record.attemptId, { status: 'running' });
        await conversationRunController.submit({
          companyId: input.companyId,
          projectId: input.projectId,
          threadId: record.threadId,
          employeeId: record.employeeId,
          runId: record.runId,
          text: objective,
          stagedAttachments: [],
          source: 'workspace',
          competitiveDraft: {
            groupId,
            sourceRunId: input.sourceRunId,
            attemptId: record.attemptId,
            attemptIndex: record.ordinal,
            totalAttempts: records.length,
          },
          delegationLimits,
        });
      } catch (error) {
        await repos.competitiveDraftAttempts.update(record.attemptId, {
          status: 'failed',
          result_summary_json: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          finished_at: new Date().toISOString(),
        });
        throw error;
      }
    }),
  );
  if (launches.every((launch) => launch.status === 'rejected')) {
    await repos.competitiveDraftGroups.updateStatus(groupId, 'failed');
    throw launches[0]?.reason ?? new Error('No competitive draft could be started.');
  }
  return {
    groupId,
    attemptIds: records.map((record) => record.attemptId),
    launchedCount: launches.filter((launch) => launch.status === 'fulfilled').length,
    failedCount: launches.filter((launch) => launch.status === 'rejected').length,
  };
}

function leaseForAttempt(
  attempt: CompetitiveDraftAttemptRow,
  leases: readonly WorkspaceLeaseReviewRow[],
): WorkspaceLeaseReviewRow | null {
  return (
    leases.find((lease) => lease.leaseId === attempt.lease_id) ??
    leases.find(
      (lease) =>
        lease.runId === attempt.run_id ||
        lease.relatedRunIds.includes(attempt.run_id) ||
        lease.relatedRootRunIds.includes(attempt.run_id),
    ) ??
    null
  );
}

export async function selectCompetitiveDraftWinner(input: {
  companyId: string;
  group: CompetitiveDraftGroupRow;
  attempts: readonly CompetitiveDraftAttemptRow[];
  winnerAttemptId: string;
  leases: readonly WorkspaceLeaseReviewRow[];
  onWinnerMerged?: (lease: WorkspaceLeaseReviewRow) => void | Promise<void>;
}): Promise<void> {
  if (input.group.status === 'merged') return;
  if (input.group.winner_attempt_id && input.group.winner_attempt_id !== input.winnerAttemptId) {
    throw new Error('A winner was already merged. Finish cleaning up the losing drafts.');
  }
  const retryingCleanup = input.group.winner_attempt_id === input.winnerAttemptId;
  if (!retryingCleanup && input.group.status !== 'reviewing') {
    throw new Error('Wait for every draft to finish before selecting a winner.');
  }
  const winner = input.attempts.find((attempt) => attempt.attempt_id === input.winnerAttemptId);
  if (!winner) throw new Error('The selected draft is no longer part of this comparison.');
  const winnerLease = leaseForAttempt(winner, input.leases);
  if (!winnerLease) {
    throw new Error('The selected draft workspace is no longer available.');
  }
  if (!retryingCleanup && winnerLease.status !== 'pending_review') {
    throw new Error('The selected draft is not ready to merge.');
  }
  if (
    retryingCleanup &&
    winnerLease.status !== 'pending_review' &&
    winnerLease.status !== 'merged'
  ) {
    throw new Error('The selected winner is not in a recoverable merge state.');
  }

  const repos = await getRepos();
  await repos.competitiveDraftGroups.updateStatus(input.group.group_id, 'merging', {
    winnerAttemptId: winner.attempt_id,
  });
  if (winnerLease.status === 'pending_review') {
    await repos.competitiveDraftAttempts.update(winner.attempt_id, {
      lease_id: winnerLease.leaseId,
    });
    try {
      await reviewWorkspaceLease(winnerLease, input.companyId, 'merge');
    } catch (error) {
      await repos.competitiveDraftGroups.updateStatus(input.group.group_id, 'reviewing', {
        winnerAttemptId: null,
      });
      throw error;
    }
  }
  await repos.competitiveDraftAttempts.update(winner.attempt_id, {
    status: 'winner',
    finished_at: new Date().toISOString(),
  });
  await input.onWinnerMerged?.(winnerLease);

  const cleanup = await Promise.allSettled(
    input.attempts
      .filter((attempt) => attempt.attempt_id !== winner.attempt_id)
      .map(async (attempt) => {
        const lease = leaseForAttempt(attempt, input.leases);
        if (
          !lease &&
          (attempt.status === 'planned' ||
            attempt.status === 'running' ||
            attempt.status === 'ready')
        ) {
          throw new Error(`Option ${attempt.ordinal} has not released its active workspace yet.`);
        }
        if (lease && lease.status !== 'discarded' && lease.status !== 'merged') {
          await repos.competitiveDraftAttempts.update(attempt.attempt_id, {
            lease_id: lease.leaseId,
          });
          await reviewWorkspaceLease(lease, input.companyId, 'discard');
        }
        if (lease?.status === 'merged') {
          throw new Error(`Option ${attempt.ordinal} was already merged and cannot be discarded.`);
        }
        await repos.competitiveDraftAttempts.update(attempt.attempt_id, {
          status: 'not_selected',
          finished_at: new Date().toISOString(),
        });
      }),
  );
  const failed = cleanup.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    await repos.competitiveDraftGroups.updateStatus(input.group.group_id, 'failed', {
      winnerAttemptId: winner.attempt_id,
    });
    throw new Error(
      `The winning draft merged, but ${failed.length} losing worktree${failed.length === 1 ? '' : 's'} could not be cleaned up.`,
    );
  }
  await repos.competitiveDraftGroups.updateStatus(input.group.group_id, 'merged', {
    winnerAttemptId: winner.attempt_id,
  });
  const retrospectiveResults = await Promise.allSettled(
    input.attempts
      .filter((attempt) => attempt.attempt_id !== winner.attempt_id)
      .map((loser) =>
        distillCompetitiveDraftLoserMemory({
          repos,
          group: input.group,
          winner,
          loser,
        }),
      ),
  );
  for (const result of retrospectiveResults) {
    if (result.status === 'rejected') {
      console.warn('Competitive draft retrospective distillation failed.', result.reason);
    }
  }
}
