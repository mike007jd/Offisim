import type { EventBus } from '@offisim/core/browser';
import type {
  GraphNodeEnteredPayload,
  LlmStreamChunkPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect } from 'react';
import { useChatSessionStore } from '../components/chat/chat-session-store.js';

const VISIBLE_STREAMING_NODES = new Set(['boss', 'boss_summary', 'employee', 'hr']);

export function useChatStreamingSync(eventBus: EventBus): void {
  useEffect(() => {
    const unsubNodeEntered = eventBus.on(
      'graph.node.entered',
      (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        const nextNode = event.payload?.nodeName ?? null;
        if (nextNode && VISIBLE_STREAMING_NODES.has(nextNode)) {
          useChatSessionStore.getState().setActiveRunNode(nextNode, { resetContent: true });
          useChatSessionStore.getState().setActiveRunStreaming(true);
          return;
        }
        useChatSessionStore.getState().setActiveRunStreaming(false);
      },
    );

    const unsubChunk = eventBus.on(
      'llm.stream.chunk',
      (event: RuntimeEvent<LlmStreamChunkPayload>) => {
        const chunkNode = event.payload?.nodeName ?? null;
        const chunk = event.payload?.content;
        const channel = event.payload?.channel ?? 'content';
        if (!chunkNode || !VISIBLE_STREAMING_NODES.has(chunkNode) || !chunk) {
          return;
        }
        useChatSessionStore.getState().appendStreamingChunkForActiveRun(chunkNode, chunk, channel);
      },
    );

    const unsubTool = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const payload = event.payload;
        if (payload.status !== 'started' || payload.nodeName !== 'employee') {
          return;
        }
        useChatSessionStore.getState().clearActiveRunStreamingContent();
      },
    );

    return () => {
      unsubNodeEntered();
      unsubChunk();
      unsubTool();
    };
  }, [eventBus]);
}
