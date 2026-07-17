import { useUiState } from '@/app/ui-state.js';
import { markReturnedReviewPatchApplied } from '@/data/review-workbench.js';
import { parseUnifiedDiffFiles } from '@/data/unified-diff.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DiffPanel } from './DiffPanel.js';
import { publishReviewPrPrefill } from './review-pr-prefill.js';
import {
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
  leaseId: string;
  initialPath?: string | null;
  fallbackFiles?: Array<{ path: string; diff: string }>;
}

function taskForLease(
  lease: WorkspaceLeaseReviewRow,
  rows: ReturnType<typeof useTaskBoard>['rows'],
) {
  const candidates = rows.flatMap((row) => [row, ...row.children]);
  const related = candidates.filter(
    (candidate) => candidate.runId === lease.runId || lease.relatedRunIds.includes(candidate.runId),
  );
  return related.find((candidate) => candidate.employeeId) ?? related[0] ?? null;
}

export function ReviewWorkbenchStage({
  leaseId,
  initialPath,
  fallbackFiles = [],
}: ReviewWorkbenchStageProps) {
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
  const actionable = lease?.status === 'pending_review';

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
      const outcome = await reviewWorkspaceLease(lease, companyId, action);
      if (action === 'merge' && summaryBody) {
        publishReviewPrPrefill({
          projectId,
          leaseId: lease.leaseId,
          title: task?.objective?.trim() || `Review ${lease.branch ?? 'delegated work'}`,
          body: summaryBody,
        });
      }
      await reviews.refetch();
      toast.success(outcome === 'discarded' ? 'Task discarded.' : 'Task merged. PR handoff ready.');
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
    return (
      <div className="off-review-stage-state">This delegated review is no longer available.</div>
    );
  }

  return (
    <div className="off-stage-changes is-lease-review">
      <DiffPanel
        key={leaseId}
        document={document}
        mode={actionable ? 'review' : 'readonly'}
        initialPath={initialPath}
        review={lease?.review}
        busy={busy || pendingAction !== null}
        onReviewChange={(review) =>
          persistReview(review).catch((error) => {
            toast.error(safeErrorMessage(error));
          })
        }
        onMerge={(summary) => void resolveLease('merge', summary.markdown)}
        onDiscard={() => void resolveLease('discard')}
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
