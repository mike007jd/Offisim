import type { StageViewTarget } from '@/app/ui-state.js';
import type { ClaimableArtifact } from '@/assistant/runtime/scene-cue-projection.js';
import { openArtifactClaim } from '@/surfaces/office/stage-viewer/artifact-claim.js';

/**
 * THE delivery-history route both scenes share (I5): the shelf body / head /
 * +N overflow opens the latest claim's owning employee's workload drilldown,
 * falling back to opening the claim itself only when the claim is ownerless.
 *
 * Ownership is the projection-stamped `ClaimableArtifact.employeeId` (resolved
 * during the delivery walk from the beat's named employee or its run's owner)
 * — never a scene-side `threadId` join, which only knows each actor's FIRST
 * thread and misses claims from a multi-thread employee's other threads.
 */
export function openDeliveryHistory(
  latest: ClaimableArtifact | null,
  deps: {
    openWorkloadDrilldown: (employeeId: string) => void;
    openStageView: (target: StageViewTarget) => void;
    projectId: string | null;
  },
): void {
  if (!latest) return;
  if (latest.employeeId) {
    deps.openWorkloadDrilldown(latest.employeeId);
    return;
  }
  void openArtifactClaim(latest, {
    openStageView: deps.openStageView,
    projectId: deps.projectId,
  });
}
