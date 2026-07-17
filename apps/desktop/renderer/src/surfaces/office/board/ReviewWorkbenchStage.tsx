import { useUiState } from '@/app/ui-state.js';
import { markReturnedReviewPatchApplied } from '@/data/review-workbench.js';
import { useCompanyEmployees } from '@/data/queries.js';
import { loadRunCost } from '@/data/run-cost.js';
import { taskAccountingPresentation } from '@/data/task-accounting-presentation.js';
import { parseUnifiedDiffFiles } from '@/data/unified-diff.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { getRepos } from '@/runtime/repos.js';
import { useQuery } from '@tanstack/react-query';
import type {
  CompetitiveDraftAttemptRow,
  CompetitiveDraftGroupRow,
} from '@offisim/core/browser';
import { CheckCircle2, ChevronRight, CircleX, Clock3, GitCompareArrows, Trophy } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DiffPanel } from './DiffPanel.js';
import { selectCompetitiveDraftWinner } from './competitive-draft-actions.js';
import { publishReviewPrPrefill } from './review-pr-prefill.js';
import {
  type TaskBoardChildRow,
  type WorkspaceLeaseReviewRow,
  useProjectWorkspaceLeaseReviews,
  useTaskBoard,
} from './task-board-data.js';
import { useWorkspaceLeaseDecision } from './use-workspace-lease-decision.js';
import {
  applyWorkspaceLeaseReviewPatch,
  persistWorkspaceLeaseReview,
  requestWorkspaceLeaseChanges,
  reviewWorkspaceLease,
} from './workspace-lease-actions.js';

interface ReviewWorkbenchStageProps {
  leaseId?: string;
  comparisonGroupId?: string;
  initialPath?: string | null;
  fallbackFiles?: Array<{ path: string; diff: string }>;
}

function taskForLease(
  lease: WorkspaceLeaseReviewRow,
  rows: ReturnType<typeof useTaskBoard>['rows'],
) {
  const candidates = rows.flatMap((row) => [row, ...row.children]);
  const related = candidates.filter(
    (candidate) =>
      candidate.runId === lease.runId ||
      lease.relatedRunIds.includes(candidate.runId) ||
      lease.relatedRootRunIds.includes(candidate.runId),
  );
  return related.find((candidate) => candidate.employeeId) ?? related[0] ?? null;
}

function leaseForAttempt(
  attempt: CompetitiveDraftAttemptRow,
  leases: readonly WorkspaceLeaseReviewRow[],
) {
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

function diffStats(files: readonly { diff: string }[]) {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    for (const line of file.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
      if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
    }
  }
  return { added, removed };
}

function durationLabel(startedAt: string, finishedAt: string | null): string {
  const elapsed = Math.max(0, Date.parse(finishedAt ?? new Date().toISOString()) - Date.parse(startedAt));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.round(elapsed / 1_000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function competitiveStatusLabel(status: CompetitiveDraftGroupRow['status']): string {
  if (status === 'drafting') return 'Drafting in parallel';
  if (status === 'reviewing') return 'Ready to compare';
  if (status === 'merging') return 'Merging winner and cleaning up';
  if (status === 'merged') return 'Winner merged';
  if (status === 'failed') return 'Needs attention';
  return 'Cancelled';
}

export function ReviewWorkbenchStage(props: ReviewWorkbenchStageProps) {
  const competitiveAttempt = useQuery({
    queryKey: ['competitive-draft-attempt-by-lease', props.leaseId],
    queryFn: async () => {
      if (!props.leaseId) return null;
      const repos = await getRepos();
      return repos.competitiveDraftAttempts.findByLeaseId(props.leaseId);
    },
    enabled: Boolean(props.leaseId) && !props.comparisonGroupId,
  });
  if (props.comparisonGroupId) {
    return <CompetitiveDraftReview comparisonGroupId={props.comparisonGroupId} />;
  }
  if (!props.leaseId) {
    return <div className="off-review-stage-state">No delegated review was selected.</div>;
  }
  if (competitiveAttempt.isLoading) {
    return <div className="off-review-stage-state">Loading competitive draft…</div>;
  }
  if (competitiveAttempt.data) {
    return <CompetitiveDraftReview comparisonGroupId={competitiveAttempt.data.group_id} />;
  }
  return (
    <SingleLeaseReview
      leaseId={props.leaseId}
      initialPath={props.initialPath}
      fallbackFiles={props.fallbackFiles}
    />
  );
}

function SingleLeaseReview({
  leaseId,
  initialPath,
  fallbackFiles = [],
  comparison,
}: {
  leaseId: string;
  initialPath?: string | null;
  fallbackFiles?: Array<{ path: string; diff: string }>;
  comparison?: {
    onBack: () => void;
    onAdopt: (summaryBody: string) => Promise<void>;
    canAdopt: boolean;
  };
}) {
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const reviews = useProjectWorkspaceLeaseReviews(projectId || null);
  const board = useTaskBoard(companyId || null);
  const lease = reviews.rows.find((candidate) => candidate.leaseId === leaseId) ?? null;
  const task = lease ? taskForLease(lease, board.rows) : null;
  const pendingAction = useWorkspaceLeaseDecision(leaseId);
  const [busy, setBusy] = useState(false);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const files = lease?.files.length ? lease.files : fallbackFiles;
  const document = useMemo(() => parseUnifiedDiffFiles(files), [files]);
  const actionable =
    lease?.status === 'pending_review' && (!comparison || comparison.canAdopt);

  const persistReview = (review: Parameters<typeof persistWorkspaceLeaseReview>[2]) => {
    if (!lease || !companyId) return Promise.resolve();
    saveChain.current = saveChain.current
      .catch(() => undefined)
      .then(() => persistWorkspaceLeaseReview(lease, companyId, review));
    return saveChain.current;
  };

  const resolveLease = async (action: 'merge' | 'discard', summaryBody?: string) => {
    if (!lease || !companyId || !projectId) return;
    setBusy(true);
    try {
      if (action === 'merge' && comparison) {
        await comparison.onAdopt(summaryBody ?? 'Selected from competitive drafting review.');
      } else {
        const outcome = await reviewWorkspaceLease(lease, companyId, action);
        if (action === 'merge' && summaryBody) {
          publishReviewPrPrefill({
            projectId,
            leaseId: lease.leaseId,
            title: task?.objective?.trim() || `Review ${lease.branch ?? 'delegated work'}`,
            body: summaryBody,
          });
        }
        toast.success(outcome === 'discarded' ? 'Task discarded.' : 'Task merged. PR handoff ready.');
      }
      await reviews.refetch();
    } catch (error) {
      toast.error(safeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!lease && reviews.isLoading) {
    return <div className="off-review-stage-state">Loading delegated review…</div>;
  }
  if (!lease && files.length === 0) {
    return <div className="off-review-stage-state">This delegated review is no longer available.</div>;
  }

  return (
    <div className="off-stage-changes is-lease-review">
      {comparison ? (
        <button type="button" className="off-focusable off-competitive-review-back" onClick={comparison.onBack}>
          Back to side-by-side comparison
        </button>
      ) : null}
      <DiffPanel
        key={leaseId}
        document={document}
        mode={actionable ? 'review' : 'readonly'}
        initialPath={initialPath}
        review={lease?.review}
        busy={busy || pendingAction !== null}
        mergeLabel={comparison ? 'Adopt this draft' : undefined}
        discardLabel={comparison ? 'Back to comparison' : undefined}
        onReviewChange={(review) =>
          persistReview(review).catch((error) => {
            toast.error(safeErrorMessage(error));
          })
        }
        onMerge={(summary) => void resolveLease('merge', summary.markdown)}
        onDiscard={comparison?.onBack ?? (() => void resolveLease('discard'))}
        onRequestChanges={async ({ feedback, review, annotations, returnedPatch }) => {
          if (!lease || !companyId || !projectId || !task?.employeeId) {
            const error = new Error('The delegated review has no active assignee or Project.');
            toast.error(error.message);
            throw error;
          }
          setBusy(true);
          try {
            let effectiveReview = review;
            if (returnedPatch) {
              await applyWorkspaceLeaseReviewPatch(lease, returnedPatch);
              effectiveReview = markReturnedReviewPatchApplied(review);
              await persistReview(effectiveReview);
            }
            await requestWorkspaceLeaseChanges(lease, {
              companyId,
              projectId,
              employeeId: task.employeeId,
              objective: task.objective ?? 'Continue the delegated task.',
              feedback,
              review: effectiveReview,
              annotations,
            });
            await reviews.refetch();
            toast.success('Review steer accepted in the same worktree.');
          } catch (error) {
            await reviews.refetch();
            toast.error(safeErrorMessage(error));
            throw error;
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function CompetitiveDraftReview({ comparisonGroupId }: { comparisonGroupId: string }) {
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const employeeQuery = useCompanyEmployees(companyId || null);
  const board = useTaskBoard(companyId || null);
  const reviews = useProjectWorkspaceLeaseReviews(projectId || null);
  const comparison = useQuery({
    queryKey: ['competitive-draft-review', comparisonGroupId],
    queryFn: async () => {
      const repos = await getRepos();
      const group = await repos.competitiveDraftGroups.findById(comparisonGroupId);
      if (!group) return null;
      const attempts = await repos.competitiveDraftAttempts.listByGroup(comparisonGroupId);
      const costs = Object.fromEntries(
        await Promise.all(
          attempts.map(async (attempt) => [
            attempt.attempt_id,
            companyId
              ? await loadRunCost(companyId, attempt.thread_id).catch(() => null)
              : null,
          ] as const),
        ),
      );
      return { group, attempts: [...attempts].sort((a, b) => a.ordinal - b.ordinal), costs };
    },
    enabled: Boolean(companyId),
    refetchInterval: 2_000,
  });
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [busyAttemptId, setBusyAttemptId] = useState<string | null>(null);
  const data = comparison.data;
  const employeeById = useMemo(
    () => new Map((employeeQuery.data ?? []).map((employee) => [employee.id, employee])),
    [employeeQuery.data],
  );
  const taskByAttempt = useMemo(() => {
    const map = new Map<string, TaskBoardChildRow>();
    for (const row of board.rows) {
      for (const child of row.children) {
        if (child.competitiveDraftAttemptId) map.set(child.competitiveDraftAttemptId, child);
      }
    }
    return map;
  }, [board.rows]);

  const adopt = async (
    group: CompetitiveDraftGroupRow,
    attempts: readonly CompetitiveDraftAttemptRow[],
    attempt: CompetitiveDraftAttemptRow,
    summaryBody: string,
  ) => {
    if (!companyId || !projectId) return;
    setBusyAttemptId(attempt.attempt_id);
    try {
      await selectCompetitiveDraftWinner({
        companyId,
        group,
        attempts,
        winnerAttemptId: attempt.attempt_id,
        leases: reviews.rows,
        onWinnerMerged: (lease) => {
          publishReviewPrPrefill({
            projectId,
            leaseId: lease.leaseId,
            title: group.objective,
            body: summaryBody,
          });
        },
      });
      await Promise.all([comparison.refetch(), reviews.refetch(), board.refetch()]);
      toast.success('Winning draft merged. Losing worktrees were cleaned up.');
    } catch (error) {
      await Promise.all([comparison.refetch(), reviews.refetch(), board.refetch()]);
      throw error;
    } finally {
      setBusyAttemptId(null);
    }
  };

  if (comparison.isLoading) {
    return <div className="off-review-stage-state">Loading competitive drafts…</div>;
  }
  if (comparison.isError) {
    return <div className="off-review-stage-state">Competitive drafts could not be loaded.</div>;
  }
  if (!data) {
    return <div className="off-review-stage-state">This competitive draft no longer exists.</div>;
  }
  const selected = data.attempts.find((attempt) => attempt.attempt_id === selectedAttemptId);
  const selectedLease = selected ? leaseForAttempt(selected, reviews.rows) : null;
  if (selected && selectedLease) {
    return (
      <SingleLeaseReview
        leaseId={selectedLease.leaseId}
        comparison={{
          onBack: () => setSelectedAttemptId(null),
          onAdopt: (summary) => adopt(data.group, data.attempts, selected, summary),
          canAdopt:
            !data.group.winner_attempt_id &&
            data.group.status === 'reviewing' &&
            selectedLease.status === 'pending_review',
        }}
      />
    );
  }

  return (
    <div className="off-competitive-review">
      <header className="off-competitive-review-header">
        <div>
          <small>Competitive draft · {data.attempts.length} independent proposals</small>
          <h2>{data.group.objective}</h2>
        </div>
        <span className={`is-${data.group.status}`}>
          {competitiveStatusLabel(data.group.status)}
        </span>
      </header>
      <div className="off-competitive-review-grid">
        {data.attempts.map((attempt) => {
          const employee = employeeById.get(attempt.employee_id);
          const task = taskByAttempt.get(attempt.attempt_id);
          const lease = leaseForAttempt(attempt, reviews.rows);
          const stats = diffStats(lease?.files ?? []);
          const accounting = taskAccountingPresentation(data.costs[attempt.attempt_id]);
          const verificationPassed =
            lease?.verificationPassed ?? attempt.verification_passed;
          const verificationSummary =
            lease?.verificationSummary ?? attempt.verification_summary;
          const isWinner = data.group.winner_attempt_id === attempt.attempt_id;
          const ready = lease?.status === 'pending_review';
          const canAdopt =
            !data.group.winner_attempt_id && data.group.status === 'reviewing' && ready;
          const canRetryCleanup =
            isWinner &&
            (data.group.status === 'merging' || data.group.status === 'failed') &&
            Boolean(data.group.winner_attempt_id);
          return (
            <article className={isWinner ? 'is-winner' : undefined} key={attempt.attempt_id}>
              <header>
                {employee ? (
                  <EmployeeAvatar
                    seed={employee.id}
                    colorA={employee.avatarA}
                    colorB={employee.avatarB}
                    appearance={employee.appearance}
                    brand={employee.kind === 'external'}
                    size={36}
                  />
                ) : null}
                <span>
                  <small>Option {attempt.ordinal}</small>
                  <b>{employee?.name ?? `Employee ${attempt.ordinal}`}</b>
                  <em>{employee?.role ?? 'Assigned employee'}</em>
                  {isWinner ? <em>Winner</em> : null}
                </span>
                {isWinner ? <Icon icon={Trophy} size="sm" /> : null}
              </header>
              <div className="off-competitive-review-stats">
                <span><b>{lease?.files.length ?? 0}</b> files</span>
                <span className="is-add">+{stats.added}</span>
                <span className="is-remove">−{stats.removed}</span>
              </div>
              <div className="off-competitive-review-facts">
                <span>
                  {verificationPassed === false ? <CircleX aria-hidden /> : <CheckCircle2 aria-hidden />}
                  {verificationPassed === true
                    ? verificationSummary ?? 'Verification passed'
                    : verificationPassed === false
                      ? verificationSummary ?? 'Verification failed'
                      : attempt.status === 'planned' || attempt.status === 'running'
                        ? 'Verification pending'
                        : verificationSummary ?? 'Verification unavailable'}
                </span>
                <span><Clock3 aria-hidden /> {durationLabel(attempt.started_at, attempt.finished_at ?? task?.finishedAt ?? null)}</span>
                <span title={accounting.title}>{accounting.primary}</span>
                {accounting.secondary ? <small>{accounting.secondary}</small> : null}
              </div>
              <footer>
                <button
                  type="button"
                  className="off-focusable"
                  disabled={!lease?.files.length}
                  onClick={() => setSelectedAttemptId(attempt.attempt_id)}
                >
                  <Icon icon={GitCompareArrows} size="sm" /> Full review <ChevronRight aria-hidden />
                </button>
                {canAdopt || canRetryCleanup ? (
                  <button
                    type="button"
                    className="off-focusable is-primary"
                    disabled={busyAttemptId !== null}
                    onClick={() => {
                      void adopt(
                        data.group,
                        data.attempts,
                        attempt,
                        `Selected Option ${attempt.ordinal} after side-by-side review of ${data.attempts.length} independent drafts.`,
                      ).catch((error) => toast.error(safeErrorMessage(error)));
                    }}
                    >
                    <Icon icon={Trophy} size="sm" />
                    {busyAttemptId === attempt.attempt_id
                      ? canRetryCleanup
                        ? 'Cleaning up…'
                        : 'Merging…'
                      : canRetryCleanup
                        ? 'Retry cleanup'
                        : 'Adopt proposal'}
                  </button>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
