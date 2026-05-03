import type { EventBus } from '@offisim/core/browser';
import type {
  ExecutionAbortedPayload,
  GraphNodeEnteredPayload,
  InteractionRequestedPayload,
  LlmStreamChunkPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect } from 'react';
import { useChatSessionStore } from '../components/chat/chat-session-store.js';

const VISIBLE_STREAMING_NODES = new Set(['boss', 'boss_summary', 'employee', 'hr', 'manager']);

/**
 * Match the event's chat run scope against the store's currently active run.
 * Drops events that lack scope, mismatch scope, or arrive while no run is active.
 *
 * Returns the active scope `{ conversationKey, runId }` to pass into store
 * actions, or null if the event must be dropped.
 */
function matchActiveRunScope(payload: {
  chatConversationKey?: string;
  chatRunId?: string;
}): { conversationKey: string; runId: string } | null {
  const active = useChatSessionStore.getState().activeRun;
  if (!active) return null;
  const eventConversationKey = payload?.chatConversationKey;
  const eventRunId = payload?.chatRunId;
  if (!eventConversationKey || !eventRunId) return null;
  if (eventConversationKey !== active.conversationKey) return null;
  if (eventRunId !== active.runId) return null;
  return { conversationKey: active.conversationKey, runId: active.runId };
}

/**
 * Called ONLY by OffisimRuntimeProvider.sendMessage catch block.
 * Guards against double-commit: if the run was already terminated
 * (e.g., by execution.aborted arriving first), this is a no-op.
 *
 * Reads the active run's scope once at call time so the terminate writes
 * against the run that was active when the failure happened.
 */
function terminateRun(status: 'failed' | 'interrupted'): void {
  const store = useChatSessionStore.getState();
  const active = store.activeRun;
  if (!active) return;
  store.terminateActiveRun(active.conversationKey, active.runId, { status });
}

export function terminateRunWithError(): void {
  terminateRun('failed');
}

export function terminateRunAsInterrupted(): void {
  terminateRun('interrupted');
}

export function useChatStreamingSync(eventBus: EventBus): void {
  useEffect(() => {
    const unsubNodeEntered = eventBus.on(
      'graph.node.entered',
      (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        const scope = matchActiveRunScope(event.payload ?? {});
        if (!scope) {
          if (
            import.meta.env.DEV &&
            event.payload?.nodeName &&
            VISIBLE_STREAMING_NODES.has(event.payload.nodeName) &&
            useChatSessionStore.getState().activeRun !== null
          ) {
            // eslint-disable-next-line no-console
            console.warn(
              '[useChatStreamingSync] dropped graph.node.entered for visible chat node without matching scope',
              {
                nodeName: event.payload.nodeName,
                eventChatConversationKey: event.payload.chatConversationKey,
                eventChatRunId: event.payload.chatRunId,
                activeRun: useChatSessionStore.getState().activeRun,
              },
            );
          }
          return;
        }

        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;

        const nextNode = event.payload?.nodeName ?? null;
        if (nextNode && VISIBLE_STREAMING_NODES.has(nextNode)) {
          store.commitSpeakerSegment(scope.conversationKey, scope.runId);
          store.setActiveRunNode(nextNode, { resetContent: true });
          store.setActiveRunStreaming(false);
          return;
        }
        store.commitSpeakerSegment(scope.conversationKey, scope.runId);
        store.setActiveRunNode(null, { resetContent: true });
        store.setActiveRunStreaming(false);
      },
    );

    const unsubChunk = eventBus.on(
      'llm.stream.chunk',
      (event: RuntimeEvent<LlmStreamChunkPayload>) => {
        const scope = matchActiveRunScope(event.payload ?? {});
        if (!scope) {
          if (
            import.meta.env.DEV &&
            event.payload?.nodeName &&
            VISIBLE_STREAMING_NODES.has(event.payload.nodeName) &&
            useChatSessionStore.getState().activeRun !== null
          ) {
            // eslint-disable-next-line no-console
            console.warn(
              '[useChatStreamingSync] dropped llm.stream.chunk for visible chat node without matching scope',
              {
                nodeName: event.payload.nodeName,
                eventChatConversationKey: event.payload.chatConversationKey,
                eventChatRunId: event.payload.chatRunId,
                activeRun: useChatSessionStore.getState().activeRun,
              },
            );
          }
          return;
        }

        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;

        const chunkNode = event.payload?.nodeName ?? null;
        const chunk = event.payload?.content;
        const channel = event.payload?.channel ?? 'content';
        if (!chunkNode || !VISIBLE_STREAMING_NODES.has(chunkNode) || !chunk) {
          return;
        }
        store.appendStreamingChunkForActiveRun(
          scope.conversationKey,
          scope.runId,
          chunkNode,
          chunk,
          channel,
        );
      },
    );

    const unsubTool = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const scope = matchActiveRunScope(event.payload ?? {});
        if (!scope) return;

        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;

        const payload = event.payload;
        if (payload.status !== 'started' || payload.nodeName !== 'employee') {
          return;
        }
        store.commitToolCallCheckpoint(scope.conversationKey, scope.runId);
      },
    );

    const unsubInteractionRequested = eventBus.on(
      'interaction.requested',
      (event: RuntimeEvent<InteractionRequestedPayload>) => {
        const scope = matchActiveRunScope(event.payload ?? {});
        if (!scope) return;
        useChatSessionStore.getState().commitToolCallCheckpoint(scope.conversationKey, scope.runId);
      },
    );

    const unsubAborted = eventBus.on(
      'execution.aborted',
      (event: RuntimeEvent<ExecutionAbortedPayload>) => {
        const scope = matchActiveRunScope(event.payload ?? {});
        if (!scope) return;
        // Use scope-validated path: explicit no-op on mismatch already handled.
        const store = useChatSessionStore.getState();
        if (store.isActiveRunTerminated()) return;
        store.terminateActiveRun(scope.conversationKey, scope.runId, { status: 'interrupted' });
      },
    );

    return () => {
      unsubNodeEntered();
      unsubChunk();
      unsubTool();
      unsubInteractionRequested();
      unsubAborted();
    };
  }, [eventBus]);
}
