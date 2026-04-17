import type { EventBus } from '@offisim/core/browser';
import type {
  GraphNodeEnteredPayload,
  LlmStreamChunkPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect } from 'react';
import { useChatSessionStore } from '../components/chat/chat-session-store.js';

const VISIBLE_STREAMING_NODES = new Set(['boss', 'boss_summary', 'employee', 'hr', 'manager']);

/**
 * Called ONLY by OffisimRuntimeProvider.sendMessage catch block.
 * Guards against double-commit: if the run was already terminated
 * (e.g., by execution.aborted arriving first), this is a no-op.
 */
export function terminateRunWithError(): void {
  const store = useChatSessionStore.getState();
  if (store.isActiveRunTerminated()) return;
  store.terminateActiveRun({ status: 'failed' });
}

export function useChatStreamingSync(eventBus: EventBus): void {
  useEffect(() => {
    const unsubNodeEntered = eventBus.on(
      'graph.node.entered',
      (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;

        const nextNode = event.payload?.nodeName ?? null;
        if (nextNode && VISIBLE_STREAMING_NODES.has(nextNode)) {
          store.commitSpeakerSegment();
          store.setActiveRunNode(nextNode, { resetContent: true });
          store.setActiveRunStreaming(false);
          return;
        }
        store.commitSpeakerSegment();
        store.setActiveRunNode(null, { resetContent: true });
        store.setActiveRunStreaming(false);
      },
    );

    const unsubChunk = eventBus.on(
      'llm.stream.chunk',
      (event: RuntimeEvent<LlmStreamChunkPayload>) => {
        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;

        const chunkNode = event.payload?.nodeName ?? null;
        const chunk = event.payload?.content;
        const channel = event.payload?.channel ?? 'content';
        if (!chunkNode || !VISIBLE_STREAMING_NODES.has(chunkNode) || !chunk) {
          return;
        }
        store.appendStreamingChunkForActiveRun(chunkNode, chunk, channel);
      },
    );

    const unsubTool = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;

        const payload = event.payload;
        if (payload.status !== 'started' || payload.nodeName !== 'employee') {
          return;
        }
        store.clearActiveRunStreamingContent();
      },
    );

    const unsubAborted = eventBus.on('execution.aborted', () => {
      useChatSessionStore.getState().terminateActiveRun({ status: 'interrupted' });
    });

    return () => {
      unsubNodeEntered();
      unsubChunk();
      unsubTool();
      unsubAborted();
    };
  }, [eventBus]);
}
