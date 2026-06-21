/**
 * Agent-run event factory — wraps a neutral `AgentRunEvent` (the delegation
 * run-tree vocabulary) into a runtime bus event. Rides the bus as a single
 * `agent.run` family event; consumers subscribe `on('agent.run', …)` and switch
 * on `payload.type`. See `packages/shared-types/src/events/agent-run.ts`.
 */
import type { AgentRunEvent, RuntimeEvent } from '@offisim/shared-types';

export function agentRunEvent(
  companyId: string,
  event: AgentRunEvent,
): RuntimeEvent<AgentRunEvent> {
  return {
    type: 'agent.run',
    entityId: event.runId,
    entityType: 'runtime',
    companyId,
    threadId: event.threadId,
    timestamp: Date.now(),
    payload: event,
  };
}
