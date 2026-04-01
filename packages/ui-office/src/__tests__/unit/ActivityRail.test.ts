import type { RuntimeEvent as SharedRuntimeEvent } from '@offisim/shared-types';
import { act, render, screen, waitFor } from '@testing-library/react';
import { type PropsWithChildren, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityRail } from '../../components/chat/ActivityRail';
import {
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeValue,
} from '../../runtime/offisim-runtime-context';

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

describe('ActivityRail', () => {
  it('renders live tool activity and plan milestones from runtime events', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

    expect(screen.getByText('Warming up the runtime')).toBeInTheDocument();

    act(() => {
      eventBus.emit({
        type: 'plan.created',
        entityId: 'plan-1',
        entityType: 'plan',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          planId: 'plan-1',
          threadId: 'thread-1',
          summary: 'Refactor auth and ship landing polish',
          steps: [{ stepIndex: 0, description: 'a', taskCount: 1, tasks: [] }],
        },
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
          toolName: 'bash',
          toolType: 'builtin',
          threadId: 'thread-1',
          nodeName: 'employee',
          startedAt: Date.now() - 2200,
          status: 'started',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('PM created 1 step')).toBeInTheDocument();
      expect(screen.getByText('Started bash')).toBeInTheDocument();
      expect(screen.getByText('bash')).toBeInTheDocument();
    });
  });

  it('shows completed tool outcomes once telemetry closes', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-2',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          toolCallId: 'tool-2',
          toolName: 'read_file',
          toolType: 'builtin',
          threadId: 'thread-1',
          startedAt: Date.now() - 1200,
          status: 'completed',
          completedAt: Date.now(),
          durationMs: 1200,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Completed read file in 1.2s')).toBeInTheDocument();
    });
  });
});
