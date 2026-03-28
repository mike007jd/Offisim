import { act, render, screen, waitFor } from '@testing-library/react';
import type { RuntimeEvent as SharedRuntimeEvent } from '@offisim/shared-types';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLog, primeEventLogStore } from '../../components/events/EventLog';
import { OffisimRuntimeContext, type OffisimRuntimeValue } from '../../runtime/offisim-runtime-context';

type TestEvent = {
  type: string;
  timestamp: number;
  entityId?: string;
  companyId?: string;
  payload: Record<string, unknown>;
};

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
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }

  once(prefix: string, handler: (event: TestEvent) => void) {
    const off = this.on(prefix, (event) => {
      off();
      handler(event);
    });
    return off;
  }

  removeAll() {
    this.subscriptions = [];
  }
}

function createRuntimeValue(
  eventBus: TestEventBus,
  bootstrapState?: OffisimRuntimeValue['bootstrapState'],
): OffisimRuntimeValue {
  return {
    eventBus: eventBus as unknown as OffisimRuntimeValue['eventBus'],
    isReady: true,
    isRunning: false,
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
    bootstrapState: bootstrapState ?? null,
  };
}

function createWrapper(runtimeValue: OffisimRuntimeValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <OffisimRuntimeContext.Provider value={runtimeValue}>{children}</OffisimRuntimeContext.Provider>;
  };
}

describe('EventLog', () => {
  let rafId = 0;
  const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++rafId;
      const timer = setTimeout(() => callback(performance.now()), 0);
      rafTimers.set(id, timer);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const timer = rafTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        rafTimers.delete(id);
      }
    });
  });

  afterEach(() => {
    for (const timer of rafTimers.values()) {
      clearTimeout(timer);
    }
    rafTimers.clear();
    vi.unstubAllGlobals();
  });

  it('restores cached events when remounted with the same event bus', async () => {
    const eventBus = new TestEventBus();
    const wrapper = createWrapper(createRuntimeValue(eventBus));
    const emittedEvent: TestEvent = {
      type: 'task.state.changed',
      timestamp: Date.now(),
      companyId: 'company-1',
      entityId: 'task-1',
      payload: {
        prev: 'queued',
        next: 'running',
      },
    };

    const firstRender = render(<EventLog />, { wrapper });

    act(() => {
      eventBus.emit(emittedEvent);
    });

    await waitFor(() => {
      expect(screen.getByText('task state: queued → running')).toBeInTheDocument();
    });

    firstRender.unmount();

    render(<EventLog />, { wrapper });

    expect(screen.getByText('task state: queued → running')).toBeInTheDocument();
  });

  it('captures events before EventLog mounts once the shared store is primed', async () => {
    const eventBus = new TestEventBus();
    const wrapper = createWrapper(createRuntimeValue(eventBus));

    primeEventLogStore(eventBus as unknown as OffisimRuntimeValue['eventBus']);

    act(() => {
      eventBus.emit({
        type: 'plan.created',
        timestamp: Date.now(),
        companyId: 'company-1',
        entityId: 'plan-1',
        payload: {
          name: 'Pre-mounted plan',
        },
      });
    });

    render(<EventLog />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Pre-mounted plan')).toBeInTheDocument();
    });
  });

  it('hydrates persisted event history before live events arrive', async () => {
    const eventBus = new TestEventBus();
    const bootstrapEvent = {
      type: 'employee.created',
      timestamp: Date.now(),
      companyId: 'company-1',
      entityId: 'emp-1',
      payload: {
        employeeId: 'emp-1',
        name: 'Bootstrap Agent',
        roleSlug: 'developer',
      },
    } satisfies SharedRuntimeEvent<Record<string, unknown>>;

    const wrapper = createWrapper(
      createRuntimeValue(eventBus, {
        reposSnapshot: null,
        eventHistory: [bootstrapEvent],
      }),
    );

    render(<EventLog />, { wrapper });

    expect(screen.getByText('Bootstrap Agent')).toBeInTheDocument();
  });
});
