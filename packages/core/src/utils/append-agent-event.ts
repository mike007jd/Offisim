import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from './generate-id.js';

/**
 * Append an immutable agent event to the event sourcing log.
 * No-op if agentEvents repo is not available (backward compatible).
 *
 * @returns The generated event_id, or undefined if skipped.
 */
export async function appendAgentEvent(
  runtimeCtx: RuntimeContext,
  opts: {
    projectId?: string | null;
    threadId: string;
    agentName: string;
    eventType: string;
    payload: Record<string, unknown>;
    parentEventId?: string | null;
  },
): Promise<string | undefined> {
  const repo = runtimeCtx.repos.agentEvents;
  if (!repo) return undefined;

  const eventId = generateId('evt');
  await repo.append({
    event_id: eventId,
    project_id: opts.projectId ?? null,
    thread_id: opts.threadId,
    company_id: runtimeCtx.companyId,
    agent_name: opts.agentName,
    event_type: opts.eventType,
    payload_json: JSON.stringify(opts.payload),
    parent_event_id: opts.parentEventId ?? null,
  });
  return eventId;
}
