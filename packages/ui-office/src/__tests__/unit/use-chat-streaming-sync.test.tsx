import type { RuntimeEvent as SharedRuntimeEvent } from '@offisim/shared-types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  getConversationKey,
  useChatSessionStore,
} from '../../components/chat/chat-session-store.js';
import { useChatStreamingSync } from '../../runtime/use-chat-streaming-sync.js';

type TestEvent = SharedRuntimeEvent<Record<string, unknown>>;

class TestEventBus {
  private subscriptions: Array<{ prefix: string; handler: (event: TestEvent) => void }> = [];

  emit(event: TestEvent) {
    for (const sub of this.subscriptions) {
      if (sub.prefix === '' || event.type.startsWith(sub.prefix)) {
        sub.handler(event);
      }
    }
  }

  on(prefix: string, handler: (event: TestEvent) => void) {
    const sub = { prefix, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }
}

describe('useChatStreamingSync', () => {
  it('syncs visible llm stream chunks into the active chat run', () => {
    useChatSessionStore.getState().reset();
    const eventBus = new TestEventBus();
    const conversationKey = getConversationKey({ threadId: 'thread-1', targetEmployeeId: null });

    useChatSessionStore.getState().startRun(conversationKey);
    renderHook(() => useChatStreamingSync(eventBus as never));

    act(() => {
      eventBus.emit({
        type: 'graph.node.entered',
        entityId: 'boss',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'boss' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'boss',
        entityType: 'llm',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'boss', content: 'Hello' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'boss',
        entityType: 'llm',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'boss', content: ' there' },
      });
    });

    const stream = useChatSessionStore.getState().conversations[conversationKey]?.streaming;
    expect(stream).toMatchObject({
      nodeName: 'boss',
      content: 'Hello there',
      isStreaming: true,
    });
  });

  it('routes reasoning chunks into the reasoning channel without polluting final content', () => {
    useChatSessionStore.getState().reset();
    const eventBus = new TestEventBus();
    const conversationKey = getConversationKey({ threadId: 'thread-2', targetEmployeeId: null });

    useChatSessionStore.getState().startRun(conversationKey);
    renderHook(() => useChatStreamingSync(eventBus as never));

    act(() => {
      eventBus.emit({
        type: 'graph.node.entered',
        entityId: 'boss',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-2',
        timestamp: Date.now(),
        payload: { nodeName: 'boss' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'boss',
        entityType: 'llm',
        companyId: 'co-1',
        threadId: 'thread-2',
        timestamp: Date.now(),
        payload: { nodeName: 'boss', content: 'Need more context first', channel: 'reasoning' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'boss',
        entityType: 'llm',
        companyId: 'co-1',
        threadId: 'thread-2',
        timestamp: Date.now(),
        payload: { nodeName: 'boss', content: 'Final answer', channel: 'content' },
      });
    });

    const stream = useChatSessionStore.getState().conversations[conversationKey]?.streaming;
    expect(stream).toMatchObject({
      reasoning: 'Need more context first',
      content: 'Final answer',
    });
  });

  it('clears employee draft text when a tool step starts mid-stream', () => {
    useChatSessionStore.getState().reset();
    const eventBus = new TestEventBus();
    const conversationKey = getConversationKey({ threadId: 'thread-1', targetEmployeeId: 'emp-1' });

    useChatSessionStore.getState().startRun(conversationKey);
    renderHook(() => useChatStreamingSync(eventBus as never));

    act(() => {
      eventBus.emit({
        type: 'graph.node.entered',
        entityId: 'employee',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'employee' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'employee',
        entityType: 'llm',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'employee', content: 'Let me check that' },
      });
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          toolCallId: 'tool-1',
          toolName: 'read_file',
          toolType: 'builtin',
          threadId: 'thread-1',
          nodeName: 'employee',
          startedAt: Date.now(),
          status: 'started',
        },
      });
    });

    const stream = useChatSessionStore.getState().conversations[conversationKey]?.streaming;
    expect(stream?.nodeName).toBe('employee');
    expect(stream?.isStreaming).toBe(true);
    expect(stream?.content).toBe('');
  });
});
