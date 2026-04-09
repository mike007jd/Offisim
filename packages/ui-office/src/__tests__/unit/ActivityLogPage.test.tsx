import type { RuntimeEvent } from '@offisim/shared-types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityLogPage } from '../../components/events/workspace/ActivityLogPage.js';
import {
  OffisimRuntimeContext,
  type OffisimRuntimeValue,
} from '../../runtime/offisim-runtime-context';

class TestEventBus {
  on() {
    return () => {};
  }
}

function createRuntimeValue(events: RuntimeEvent[]): OffisimRuntimeValue {
  return {
    eventBus: new TestEventBus() as unknown as OffisimRuntimeValue['eventBus'],
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
    toolTelemetryService: null,
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    connectedMcpServers: new Set(),
    abortExecution: vi.fn(),
    unfinishedThreads: [],
    dismissUnfinishedThreads: vi.fn(),
    resumeThread: vi.fn(),
    bootstrapState: {
      reposSnapshot: null,
      eventHistory: events,
    },
  };
}

function Wrapper({
  children,
  events,
}: {
  children: ReactNode;
  events: RuntimeEvent[];
}) {
  return (
    <OffisimRuntimeContext.Provider value={createRuntimeValue(events)}>
      {children}
    </OffisimRuntimeContext.Provider>
  );
}

function makeEvent(
  overrides: Partial<RuntimeEvent<Record<string, unknown>>> = {},
): RuntimeEvent<Record<string, unknown>> {
  return {
    type: 'employee.created',
    timestamp: Date.now(),
    companyId: 'co-1',
    entityId: 'emp-1',
    entityType: 'employee',
    payload: { employeeName: 'Aria Patel' },
    ...overrides,
  };
}

describe('ActivityLogPage', () => {
  it('shows actor filter options derived from event history', async () => {
    const user = userEvent.setup();
    const onSessionStateChange = vi.fn();

    render(
      <ActivityLogPage
        sessionState={{
          selectedEventId: null,
          search: '',
          eventTypes: [],
          actorFilters: [],
          datePreset: '30d',
        }}
        onSessionStateChange={onSessionStateChange}
      />,
      {
        wrapper: ({ children }) => (
          <Wrapper
            events={[
              makeEvent({ payload: { employeeName: 'Aria Patel' } }),
              makeEvent({
                entityId: 'emp-2',
                payload: { employeeName: 'Sam Rivera' },
              }),
            ]}
          >
            {children}
          </Wrapper>
        ),
      },
    );

    expect(screen.getByTestId('workspace-activity-log')).toHaveClass('workspace-shell');

    await user.click(screen.getByRole('button', { name: 'Aria Patel' }));

    expect(onSessionStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ actorFilters: ['Aria Patel'] }),
    );
  });

  it('clears a missing focused event and shows a non-blocking toast', async () => {
    const onSessionStateChange = vi.fn();

    render(
      <ActivityLogPage
        sessionState={{
          selectedEventId: 'missing-event',
          search: '',
          eventTypes: [],
          actorFilters: [],
          datePreset: '30d',
        }}
        onSessionStateChange={onSessionStateChange}
      />,
      {
        wrapper: ({ children }) => <Wrapper events={[makeEvent()]}>{children}</Wrapper>,
      },
    );

    expect(screen.getByTestId('workspace-activity-log')).toHaveClass('workspace-shell');

    await waitFor(() => {
      expect(onSessionStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ selectedEventId: null }),
      );
    });

    expect(screen.getByText('The selected event is no longer available.')).toBeInTheDocument();
  });
});
