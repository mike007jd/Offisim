import type { RuntimeEvent as SharedRuntimeEvent } from '@offisim/shared-types';
import { act, renderHook } from '@testing-library/react';
import { type PropsWithChildren, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeValue,
} from '../../runtime/offisim-runtime-context';
import { useStreamingContent } from '../../runtime/use-streaming-content';

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

function createRuntimeValue(eventBus: TestEventBus): OffisimRuntimeValue {
  return {
    eventBus: eventBus as unknown as OffisimRuntimeValue['eventBus'],
    isReady: true,
    isRunning: true,
    error: null,
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
    clearError: vi.fn(),
    reinitRuntime: vi.fn(),
    installService: null,
    repos: null,
    employeeVersionService: null,
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    connectedMcpServers: new Set(),
    abortExecution: vi.fn(),
    unfinishedThreads: [],
    dismissUnfinishedThreads: vi.fn(),
    resumeThread: vi.fn(),
    bootstrapState: null,
  };
}

function makeWrapper(eventBus: TestEventBus) {
  const runtimeValue = createRuntimeValue(eventBus);
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      OffisimRuntimeContext.Provider,
      { value: runtimeValue },
      createElement(
        OffisimRuntimeStatusContext.Provider,
        { value: { isRunning: true, version: 1 } },
        children,
      ),
    );
  };
}

describe('useStreamingContent', () => {
  it('ignores internal nodes until a user-visible streaming node starts', () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);
    const { result } = renderHook(() => useStreamingContent(), { wrapper });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.nodeName).toBeNull();

    act(() => {
      eventBus.emit({
        type: 'graph.node.entered',
        entityId: 'pm_planner',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'pm_planner' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'pm_planner',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'pm_planner', content: 'internal planning' },
      });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.nodeName).toBeNull();
    expect(result.current.content).toBe('');
  });

  it('streams visible reply nodes and clears when execution returns to internal nodes', () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);
    const { result } = renderHook(() => useStreamingContent(), { wrapper });

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
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'boss', content: 'Hello' },
      });
      eventBus.emit({
        type: 'llm.stream.chunk',
        entityId: 'boss',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'boss', content: ' there' },
      });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.nodeName).toBe('boss');
    expect(result.current.content).toBe('Hello there');

    act(() => {
      eventBus.emit({
        type: 'graph.node.entered',
        entityId: 'pm_planner',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'pm_planner' },
      });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.nodeName).toBeNull();
    expect(result.current.content).toBe('');
  });

  it('resets visible employee stream text when the employee starts a tool step', () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);
    const { result } = renderHook(() => useStreamingContent(), { wrapper });

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
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: { nodeName: 'employee', content: 'Let me check' },
      });
    });

    expect(result.current.content).toBe('Let me check');

    act(() => {
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

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.nodeName).toBe('employee');
    expect(result.current.content).toBe('');
  });
});
