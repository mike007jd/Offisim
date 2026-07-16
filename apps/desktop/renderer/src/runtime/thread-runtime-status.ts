import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';

export const GRAPH_THREAD_STATUS_CHANGED_EVENT = 'graph.thread.status.changed';

export interface GraphThreadStatusChangedPayload {
  projectId: string | null;
  status: string;
}

export interface PersistThreadRuntimeStatusInput {
  repos: Pick<RuntimeRepositories, 'threads'>;
  eventBus: EventBus;
  companyId: string;
  threadId: string;
  projectId: string | null;
  rootTaskId: string | null;
  entryMode: 'boss_chat' | 'direct_chat';
  status: string;
}

/** Persist the runtime lifecycle before notifying presentation consumers. */
export async function persistThreadRuntimeStatus(
  input: PersistThreadRuntimeStatusInput,
): Promise<void> {
  const existing = await input.repos.threads.findById(input.threadId);
  if (!existing) {
    await input.repos.threads.create({
      thread_id: input.threadId,
      company_id: input.companyId,
      entry_mode: input.entryMode,
      root_task_id: input.rootTaskId,
      status: input.status,
      project_id: input.projectId,
    });
  } else {
    if (existing.company_id !== input.companyId) {
      throw new Error('Graph thread runtime status belongs to another company.');
    }
    await input.repos.threads.updateStatus(input.threadId, input.status);
  }

  const persisted = await input.repos.threads.findById(input.threadId);
  if (!persisted || persisted.company_id !== input.companyId || persisted.status !== input.status) {
    throw new Error('Graph thread runtime status did not persist exactly.');
  }

  const payload: GraphThreadStatusChangedPayload = {
    projectId: persisted.project_id,
    status: persisted.status,
  };
  const event: RuntimeEvent<GraphThreadStatusChangedPayload> = {
    type: GRAPH_THREAD_STATUS_CHANGED_EVENT,
    entityId: input.threadId,
    entityType: 'runtime',
    companyId: input.companyId,
    threadId: input.threadId,
    timestamp: Date.now(),
    payload,
  };
  input.eventBus.emit(event);
}
