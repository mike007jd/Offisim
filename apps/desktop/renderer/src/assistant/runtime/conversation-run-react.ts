import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  type ConversationRunSnapshot,
  type ConversationRunsSnapshot,
  type PendingApproval,
  conversationRunController,
} from './conversation-run-controller.js';
import {
  type EmployeeRunProjection,
  isConversationRunActive,
  projectEmployeeRunStates,
} from './conversation-run-projections.js';

export { isConversationRunActive };

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

export function useEmployeeRunStates(projectId: string | null): Map<string, EmployeeRunProjection> {
  const snapshot = useActiveConversationRuns();
  return useMemo(() => projectEmployeeRunStates(snapshot, projectId), [projectId, snapshot]);
}
