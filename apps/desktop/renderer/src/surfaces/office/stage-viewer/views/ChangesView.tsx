import type { StageViewTarget } from '@/app/ui-state.js';
import { useUiState } from '@/app/ui-state.js';
import { workbenchOf } from '@/data/git-workbench.js';
import { useGitWorkbench } from '@/data/queries.js';
import { parseUnifiedDiffFiles } from '@/data/unified-diff.js';
import { DiffPanel } from '@/surfaces/office/board/DiffPanel.js';
import { ReviewWorkbenchStage } from '@/surfaces/office/board/ReviewWorkbenchStage.js';
import { StageEmpty } from '@/surfaces/office/stage-preview/StageEmpty.js';
import { useEffect, useMemo } from 'react';

let reviewPresentationLeaseCount = 0;
let reviewPresentationPreviousMaximized = false;
let reviewPresentationOwnerVersion: number | null = null;

function useReviewPresentationLease() {
  useEffect(() => {
    if (reviewPresentationLeaseCount === 0) {
      reviewPresentationPreviousMaximized = useUiState.getState().officeStageMaximized;
      if (!reviewPresentationPreviousMaximized) {
        useUiState.getState().setOfficeStageMaximized(true);
        reviewPresentationOwnerVersion = useUiState.getState().officeStageMaximizedVersion;
      } else {
        reviewPresentationOwnerVersion = null;
      }
    }
    reviewPresentationLeaseCount += 1;
    return () => {
      reviewPresentationLeaseCount = Math.max(0, reviewPresentationLeaseCount - 1);
      if (reviewPresentationLeaseCount === 0) {
        const state = useUiState.getState();
        if (
          reviewPresentationOwnerVersion !== null &&
          state.officeStageMaximizedVersion === reviewPresentationOwnerVersion
        ) {
          state.setOfficeStageMaximized(reviewPresentationPreviousMaximized);
        }
        reviewPresentationOwnerVersion = null;
      }
    };
  }, []);
}

export function ChangesView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'changes' }>;
}) {
  useReviewPresentationLease();
  if (target.comparisonGroupId) {
    return <ReviewWorkbenchStage comparisonGroupId={target.comparisonGroupId} />;
  }
  if (target.leaseId) {
    return (
      <ReviewWorkbenchStage
        leaseId={target.leaseId}
        initialPath={target.path}
        fallbackFiles={target.files}
      />
    );
  }
  return target.files ? (
    <LeaseChangesView target={{ ...target, files: target.files }} />
  ) : (
    <WorkspaceChangesView target={target} />
  );
}

function LeaseChangesView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'changes' }> & {
    files: NonNullable<Extract<StageViewTarget, { kind: 'changes' }>['files']>;
  };
}) {
  const document = useMemo(() => parseUnifiedDiffFiles(target.files), [target.files]);
  return (
    <div className="off-stage-changes is-lease-review">
      <DiffPanel document={document} mode="readonly" initialPath={target.path} />
    </div>
  );
}

function WorkspaceChangesView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'changes' }>;
}) {
  const projectId = useUiState((s) => s.projectId);
  const git = useGitWorkbench(projectId);
  const workbench = workbenchOf(git.data);
  const document = useMemo(
    () => parseUnifiedDiffFiles(workbench?.diffFiles ?? []),
    [workbench?.diffFiles],
  );
  if (git.isLoading)
    return <StageEmpty title="Loading changes" detail="Reading workspace status." />;
  if (!workbench)
    return <StageEmpty title="No changes" detail="This project has no git workbench data." />;
  return (
    <div className="off-stage-changes">
      <DiffPanel document={document} mode="readonly" initialPath={target.path} />
    </div>
  );
}
