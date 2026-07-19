import { useUiState } from '@/app/ui-state.js';
import { queryKeys } from '@/data/query-keys.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import type { AgentRunEvent } from '@offisim/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Invalidate the Outputs query (`useDeliverables`) when an `artifact.created`
 * run event lands for the active thread. The `publish_artifact` tool emits the
 * event; the runtime persists the deliverable row FIRST and only then fans the
 * `agent.run` bus event (see `desktop-agent-runtime.persistArtifact`), so by the
 * time this fires the row already exists and the refetch shows it.
 *
 * Mount this alongside `useDeliverables(threadId)` for the same thread.
 */
export function useDeliverableRefresh(threadId: string | null): void {
  const companyId = useUiState((s) => s.companyId);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (companyId === null || threadId === null) return;
    // `agentRunEvent(...)` rides the bus as the `agent.run` family event; its
    // payload is the neutral AgentRunEvent (discriminated by `payload.type`).
    const off = runtimeEventBus.on('agent.run', (event) => {
      if (event.companyId !== companyId) return;
      const run = event.payload as AgentRunEvent | undefined;
      if (!run || run.type !== 'artifact.created') return;
      if (run.threadId !== threadId) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deliverables(companyId, threadId),
      });
    });
    return off;
  }, [companyId, threadId, queryClient]);
}
