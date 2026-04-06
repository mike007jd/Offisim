import type { RuntimeEvent as SharedRuntimeEvent } from '@offisim/shared-types';
import { act, render, screen } from '@testing-library/react';
import { type PropsWithChildren, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemMessageFeed } from '../../components/chat/SystemMessageFeed';
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

describe('SystemMessageFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders context, resume, and steering states as first-class system messages', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(SystemMessageFeed), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'conversation.synopsis.updated',
        entityId: 'thread-1',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          summary: 'Condensed summary',
          version: 2,
          prunedMessageCount: 18,
          totalMessageCount: 42,
        },
      });
      eventBus.emit({
        type: 'execution.resumed',
        entityId: 'thread-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          threadId: 'thread-1',
          currentStepIndex: 2,
          completedStepCount: 2,
          rewoundFromStepIndex: 1,
          skippedCompletedSteps: true,
          updatedPlan: false,
        },
      });
      eventBus.emit({
        type: 'interaction.requested',
        entityId: 'ix-question-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          request: {
            interactionId: 'ix-question-1',
            threadId: 'thread-1',
            companyId: 'co-1',
            kind: 'agent_question',
            severity: 'normal',
            title: 'Need one clarification',
            prompt: 'What kind of website do you want?',
            options: [{ id: 'answer_and_continue', label: 'Answer and continue' }],
            allowFreeformResponse: true,
            requestedByNode: 'boss',
            employeeId: null,
            taskRunId: null,
            context: { type: 'agent_question', questionKey: 'boss_clarification' },
            createdAt: Date.now(),
          },
        },
      });
    });

    expect(screen.getByText('Context Window Filling Up')).toBeInTheDocument();
    expect(screen.getByText('Resume Restored')).toBeInTheDocument();
    expect(screen.getByText('Interrupt & Steer')).toBeInTheDocument();
    expect(
      screen.getByText(/Auto-compact is summarizing earlier turns so the latest work stays live/),
    ).toBeInTheDocument();
  });

  it('surfaces memory saves and tool approval friction', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(SystemMessageFeed), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'memory.created',
        entityId: 'memory-1',
        entityType: 'memory',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          memoryId: 'memory-1',
          employeeId: 'emp-1',
          scope: 'team',
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
          toolName: 'edit_file',
          toolType: 'builtin',
          threadId: 'thread-1',
          nodeName: 'employee',
          startedAt: Date.now() - 3_200,
          status: 'denied',
          errorType: 'TOOL_PERMISSION_REQUIRED',
        },
      });
    });

    expect(screen.getByText('Auto Memory Updated')).toBeInTheDocument();
    expect(screen.getByText('Tool Approval Needed')).toBeInTheDocument();
    expect(screen.getByText('Approve edit file so execution can continue.')).toBeInTheDocument();
  });
});
