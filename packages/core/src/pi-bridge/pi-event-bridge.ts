/**
 * Event identity-tagging bridge: pi `AgentEvent` → Offisim `eventBus`.
 *
 * pi events carry no company/thread/employee identity, so N agents streaming
 * concurrently would smear into one UI stream. This wraps each agent's event
 * stream in a per-agent closure that stamps identity before emitting, keeping
 * `llm.stream.chunk` (content + reasoning channels) correctly scoped per the
 * renderer's contract (desktop-chat-runtime filters by threadId + nodeName).
 *
 * Tool telemetry (`tool.execution.telemetry`, `mcp.tool.result`) is NOT emitted
 * here — pi tool calls run through `AuditingToolExecutor`, which already emits
 * those, so re-emitting would double-count.
 */

import type { AgentEvent, AgentMessage } from '@offisim/pi-agent';
import type { RunScope } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { llmStreamChunk } from '../events/llm-events.js';

export interface PiEventIdentity {
  readonly companyId: string;
  readonly threadId: string;
  /** Stream node label the renderer filters on: 'employee' | 'boss_summary' | 'hr'. */
  readonly nodeName: string;
  readonly employeeId?: string;
  readonly runScope?: RunScope | null;
}

export interface PiEventBridgeHandlers {
  /** Called when the agent appends a finished message (assistant / tool result). */
  readonly onMessageEnd?: (message: AgentMessage) => void | Promise<void>;
  /** Called once the agent run fully settles. */
  readonly onAgentEnd?: (messages: AgentMessage[]) => void | Promise<void>;
}

/**
 * Build an `agent.subscribe` listener that forwards streaming deltas to the
 * eventBus with identity, and invokes persistence/lifecycle handlers.
 */
export function createPiEventListener(
  eventBus: EventBus,
  identity: PiEventIdentity,
  handlers: PiEventBridgeHandlers = {},
): (event: AgentEvent) => void | Promise<void> {
  const { companyId, threadId, nodeName, runScope } = identity;
  return async (event: AgentEvent) => {
    switch (event.type) {
      case 'message_update': {
        const streamEvent = event.assistantMessageEvent;
        if (streamEvent.type === 'text_delta') {
          eventBus.emit(
            llmStreamChunk(companyId, threadId, nodeName, streamEvent.delta, 'content', runScope),
          );
        } else if (streamEvent.type === 'thinking_delta') {
          eventBus.emit(
            llmStreamChunk(companyId, threadId, nodeName, streamEvent.delta, 'reasoning', runScope),
          );
        }
        break;
      }
      case 'message_end':
        await handlers.onMessageEnd?.(event.message);
        break;
      case 'agent_end':
        await handlers.onAgentEnd?.(event.messages);
        break;
      default:
        break;
    }
  };
}
