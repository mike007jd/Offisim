import type { RuntimeEvent } from '@offisim/shared-types';

export const RUN_COST_UPDATED_EVENT = 'run-cost.updated';

interface RunCostEventSink {
  emit(event: RuntimeEvent<{ runId: string }>): void;
}

/** Publish cost freshness only after the authoritative agent_runs write resolves. */
export async function persistRunCostAndNotify(input: {
  persist: () => Promise<void>;
  eventSink: RunCostEventSink;
  companyId: string;
  threadId: string;
  runId: string;
}): Promise<void> {
  await input.persist();
  input.eventSink.emit({
    type: RUN_COST_UPDATED_EVENT,
    entityId: input.runId,
    entityType: 'runtime',
    companyId: input.companyId,
    threadId: input.threadId,
    timestamp: Date.now(),
    payload: { runId: input.runId },
  });
}
