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
      expect(screen.getByText('Shell tasks')).toBeInTheDocument();
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

  it('collapses active search and shell bursts into phase-based labels', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-search-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          toolCallId: 'tool-search-1',
          toolName: 'search_code',
          toolType: 'mcp',
          serverName: 'github',
          threadId: 'thread-1',
          nodeName: 'employee',
          startedAt: Date.now() - 2400,
          status: 'started',
        },
      });
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-search-2',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          toolCallId: 'tool-search-2',
          toolName: 'glob_files',
          toolType: 'builtin',
          threadId: 'thread-1',
          nodeName: 'employee',
          startedAt: Date.now() - 1200,
          status: 'started',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Searching the codebase')).toBeInTheDocument();
      expect(screen.getByText('Searching codebase (2)')).toBeInTheDocument();
      expect(screen.getByText('Searching codebase with 2 tools')).toBeInTheDocument();
    });
  });

  it('merges consecutive completed file reads into a single burst entry', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-read-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: 1_000,
        payload: {
          toolCallId: 'tool-read-1',
          toolName: 'read_file',
          toolType: 'builtin',
          threadId: 'thread-1',
          startedAt: 100,
          completedAt: 1_000,
          durationMs: 900,
          status: 'completed',
        },
      });
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-read-2',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: 2_000,
        payload: {
          toolCallId: 'tool-read-2',
          toolName: 'fetch_file',
          toolType: 'mcp',
          serverName: 'github',
          threadId: 'thread-1',
          startedAt: 500,
          completedAt: 2_000,
          durationMs: 1_500,
          status: 'completed',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Read files with 2 tools')).toBeInTheDocument();
    });
  });

  it('surfaces compact baseline, resume, staleness, and permission friction events', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

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
        type: 'conversation.compact.completed',
        entityId: 'fcb-1',
        entityType: 'graph',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          compactId: 'fcb-1',
          compactVersion: 1,
          compactedNonSystemMessageCount: 18,
          keptTailNonSystemMessageCount: 6,
          preCompactMessageCount: 24,
          preCompactTokenCount: 1200,
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
        type: 'workspace.staleness.detected',
        entityId: 'thread-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          status: 'warn',
          reason: 'git_worktree_changed',
          baselineGitHead: 'abc',
          currentGitHead: 'abc',
          baselineDirty: false,
          currentDirty: true,
          currentStatusLines: 3,
        },
      });
      eventBus.emit({
        type: 'tool.execution.telemetry',
        entityId: 'tool-3',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          toolCallId: 'tool-3',
          toolName: 'search',
          toolType: 'mcp',
          serverName: 'github',
          threadId: 'thread-1',
          startedAt: Date.now() - 500,
          status: 'denied',
          errorType: 'TOOL_PERMISSION_REQUIRED',
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText('Compacted 18 messages and kept a 6-message live tail'),
      ).toBeInTheDocument();
      expect(screen.getByText('Rewound to step 2 and resumed')).toBeInTheDocument();
      expect(screen.getByText('Workspace changed locally (3 files)')).toBeInTheDocument();
      expect(screen.getByText('Approval needed for github/search')).toBeInTheDocument();
    });
  });

  it('uses interaction-specific labels for requested and resolved decisions', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'interaction.requested',
        entityId: 'ix-plan-1',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          request: {
            interactionId: 'ix-plan-1',
            threadId: 'thread-1',
            companyId: 'co-1',
            kind: 'plan_review',
            severity: 'normal',
            title: 'Review plan before execution',
            prompt: 'Review the generated plan.',
            options: [{ id: 'start_execution', label: 'Start execution' }],
            allowFreeformResponse: true,
            createdAt: Date.now(),
          },
        },
      });
      eventBus.emit({
        type: 'interaction.resolved',
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
            createdAt: Date.now(),
          },
          response: {
            interactionId: 'ix-question-1',
            selectedOptionId: 'answer_and_continue',
            freeformResponse: 'A SaaS landing page',
            respondedAt: Date.now(),
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Waiting for plan review').length).toBeGreaterThan(0);
      expect(screen.getByText('Clarification received: answer and continue')).toBeInTheDocument();
    });
  });

  it('shows restored pending interactions after runtime recovery', async () => {
    const eventBus = new TestEventBus();
    const wrapper = makeWrapper(eventBus);

    render(createElement(ActivityRail), { wrapper });

    act(() => {
      eventBus.emit({
        type: 'interaction.restored',
        entityId: 'ix-plan-restore',
        entityType: 'runtime',
        companyId: 'co-1',
        threadId: 'thread-1',
        timestamp: Date.now(),
        payload: {
          request: {
            interactionId: 'ix-plan-restore',
            threadId: 'thread-1',
            companyId: 'co-1',
            kind: 'plan_review',
            severity: 'normal',
            title: 'Review plan',
            prompt: 'Review before execution',
            options: [{ id: 'start_execution', label: 'Start execution' }],
            allowFreeformResponse: true,
            requestedByNode: 'pm_planner',
            employeeId: null,
            taskRunId: null,
            context: { type: 'plan_review', planId: null },
            createdAt: Date.now(),
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Restored pending plan review')).toHaveLength(2);
    });
  });
});
