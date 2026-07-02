import type { SceneBeat } from '@offisim/shared-types';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  type ConversationRunSnapshot,
  type ConversationRunsSnapshot,
  type PendingApproval,
  conversationRunController,
} from './conversation-run-controller.js';
import {
  type EmployeeWorkloadProjection,
  isConversationRunActive,
  projectEmployeeWorkloads,
} from './conversation-run-projections.js';
import { useOfficeBeats } from './office-dramaturgy.js';

export { isConversationRunActive };
export type { EmployeeWorkloadProjection };
export { useInterruptedRunRecovery } from '@/runtime/recovery/useInterruptedRunRecovery.js';

export function useConversationRun(threadId: string): ConversationRunSnapshot {
  return useSyncExternalStore(
    (listener) => conversationRunController.subscribe(threadId, listener),
    () => conversationRunController.getSnapshot(threadId),
    () => conversationRunController.getSnapshot(threadId),
  );
}

export function useActiveConversationRuns(): ConversationRunsSnapshot {
  return useSyncExternalStore(
    (listener) => conversationRunController.subscribeGlobal(listener),
    () => conversationRunController.getGlobalSnapshot(),
    () => conversationRunController.getGlobalSnapshot(),
  );
}

export function usePendingConversationApprovals(
  companyId: string | null,
): readonly PendingApproval[] {
  const snapshot = useActiveConversationRuns();
  useEffect(() => {
    if (!companyId) return;
    void conversationRunController.hydrateStaleApprovals(companyId).catch((err: unknown) => {
      console.warn('[conversation-run-react] stale approval hydration failed', { companyId, err });
    });
  }, [companyId]);

  return useMemo(() => {
    if (!companyId) return [];
    const runByThread = new Map(snapshot.runs.map((run) => [run.threadId, run]));
    return snapshot.pendingApprovals.filter(
      (approval) => runByThread.get(approval.threadId)?.companyId === companyId,
    );
  }, [companyId, snapshot]);
}

/**
 * One aggregated workload per employee — the single truth for office actor
 * lighting (activeCount), the x2/x3 badge, and the dominant performance. Joins
 * each dominant run's current scene beat from the live office timeline, so the
 * office stages the dominant ACTIVE run (not a stale just-finished one).
 */
export function useEmployeeWorkloads(
  projectId: string | null,
  companyId: string | null,
): Map<string, EmployeeWorkloadProjection> {
  const snapshot = useActiveConversationRuns();
  const beats = useOfficeBeats(companyId);
  return useMemo(() => {
    // Latest beat per runId — the dominant run's live scene direction.
    const beatByRun = new Map<string, SceneBeat>();
    for (const beat of beats) beatByRun.set(beat.runId, beat);
    return projectEmployeeWorkloads(snapshot, projectId, (runId) => beatByRun.get(runId) ?? null);
    // companyId is not read in the body — `beats` (from useOfficeBeats(companyId))
    // already re-derives when it changes, so listing companyId is redundant.
  }, [projectId, snapshot, beats]);
}
