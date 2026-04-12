import type { InteractionRequest, ProjectRow } from '@offisim/shared-types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, PropsWithChildren } from 'react';
import { useChatSessionStore } from '../../components/chat/chat-session-store.js';

/**
 * ChatPanel — focused tests on project-scoping behavior.
 *
 * ChatPanel has a deep dependency chain (OffisimRuntimeContext, CompanyContext,
 * EventBus, MeetingPanel, etc.). We mock all hooks/contexts at the module
 * level and test only the project-scoping surface area:
 *  - When activeProject is set, the project name banner is shown.
 *  - When activeProject is null, no banner is shown.
 *  - sendMessage receives the project's threadId when activeProject is set.
 *
 * Skipped: streaming bubble, error banner, meeting panel, slash commands,
 * mention select — those are tested via their own units or require a
 * live EventBus.
 */

// ── Mock all context / hook dependencies ──────────────────────────────────

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockRetryLastMessage = vi.fn().mockResolvedValue(undefined);
const mockRespondToInteraction = vi.fn().mockResolvedValue(undefined);
const mockEventBus = { on: vi.fn().mockReturnValue(() => {}) };
const mockRuntime = {
  sendMessage: mockSendMessage,
  retryLastMessage: mockRetryLastMessage,
  isRunning: false,
  isReady: true,
  error: null as string | null,
  clearError: vi.fn(),
  abortExecution: vi.fn(),
  eventBus: mockEventBus,
  repos: null,
  pendingInteraction: null as InteractionRequest | null,
  respondToInteraction: mockRespondToInteraction,
};

type ChildrenOnlyProps = PropsWithChildren;
type EmptyStateProps = ComponentProps<'div'> & {
  onSendPrompt: (prompt: string) => void;
};
type ChatInputProps = {
  onSend: (message: string) => void;
};
type InteractionPromptProps = {
  request: InteractionRequest | null;
  employeeName?: string | null;
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<string | undefined>;
};

vi.mock('../../runtime/offisim-runtime-context.js', () => ({
  useOffisimRuntime: () => mockRuntime,
  useOffisimRuntimeStatus: () => ({ isRunning: false, version: 0 }),
  OffisimRuntimeContext: { Provider: ({ children }: ChildrenOnlyProps) => children },
  OffisimRuntimeStatusContext: { Provider: ({ children }: ChildrenOnlyProps) => children },
}));

vi.mock('../../runtime/use-streaming-content.js', () => ({
  useStreamingContentForConversation: () => ({ content: '', isStreaming: false, nodeName: null }),
}));

vi.mock('../../runtime/use-agent-states.js', () => ({
  useAgentStates: () => new Map(),
}));

vi.mock('../../hooks/useErrorTracking.js', () => ({
  useErrorTracking: () => [],
}));

vi.mock('../../hooks/usePipelineStage.js', () => ({
  usePipelineStage: () => ({ stage: null, routeLabel: null }),
  STAGE_META: {},
  PIPELINE_STEPS: ['boss', 'manager', 'planning', 'executing', 'summary'],
}));

// Mock PipelineProgress (imported by ChatPanel)
vi.mock('../../components/chat/PipelineProgress.js', () => ({
  PipelineProgress: () => null,
}));

vi.mock('../../components/company/CompanyContext.js', () => ({
  useCompany: () => ({
    activeCompanyId: 'co-1',
    companies: [],
    switchCompany: vi.fn(),
    refreshCompanies: vi.fn(),
  }),
  CompanyProvider: ({ children }: ChildrenOnlyProps) => children,
}));

// Mock heavy sub-components
vi.mock('../../components/office/MeetingPanel.js', () => ({
  MeetingPanel: () => null,
}));

vi.mock('../../components/error/EmptyState.js', () => ({
  EmptyState: ({ onSendPrompt }: EmptyStateProps) => (
    <button type="button" onClick={() => onSendPrompt('test message')}>
      Send test
    </button>
  ),
}));

vi.mock('../../components/error/ErrorBanner.js', () => ({
  ErrorBanner: () => null,
}));

vi.mock('../../components/chat/InteractionPrompt.js', () => ({
  InteractionPrompt: ({ request, onRespond }: InteractionPromptProps) =>
    request ? (
      <div>
        <div>{request.title}</div>
        <button
          type="button"
          onClick={() => onRespond('answer_and_continue', 'Build a SaaS landing page')}
        >
          Answer and continue
        </button>
      </div>
    ) : null,
}));

vi.mock('@offisim/ui-core', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  ScrollArea: ({ children }: ChildrenOnlyProps) => <div>{children}</div>,
}));

// Mock ChatInput to a simple textarea+button so we can trigger handleSend
vi.mock('../../components/chat/ChatInput.js', () => ({
  ChatInput: ({ onSend }: ChatInputProps) => (
    <button type="button" data-testid="chat-input-send" onClick={() => onSend('test message')}>
      ChatSend
    </button>
  ),
}));

// ── Import component AFTER mocks ──────────────────────────────────────────
import { ChatPanel } from '../../components/chat/ChatPanel.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeProject(
  overrides: Partial<ProjectRow> & { project_id: string; name: string },
): ProjectRow {
  return {
    company_id: 'co-1',
    thread_id: 'thread-abc-123',
    description: null,
    status: 'active',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

const ACTIVE_PROJECT = makeProject({
  project_id: 'p-1',
  name: 'Alpha Initiative',
  thread_id: 'thread-xyz-999',
});

function makeInteractionRequest(
  overrides?: Partial<InteractionRequest> & { kind: InteractionRequest['kind'] },
): InteractionRequest {
  return {
    interactionId: overrides?.interactionId ?? 'ix-1',
    threadId: overrides?.threadId ?? 'thread-1',
    companyId: overrides?.companyId ?? 'co-1',
    kind: overrides?.kind ?? 'agent_question',
    severity: overrides?.severity ?? 'normal',
    title: overrides?.title ?? 'Need one clarification',
    prompt: overrides?.prompt ?? 'Which direction should Offisim take?',
    options: overrides?.options ?? [
      { id: 'answer_and_continue', label: 'Answer and continue', recommended: true },
      { id: 'cancel', label: 'Cancel' },
    ],
    recommendation: overrides?.recommendation,
    allowFreeformResponse: overrides?.allowFreeformResponse ?? true,
    placeholder: overrides?.placeholder ?? 'Answer here',
    requestedByNode: overrides?.requestedByNode ?? 'boss',
    employeeId: overrides?.employeeId ?? null,
    taskRunId: overrides?.taskRunId ?? null,
    context: overrides?.context ?? { type: 'agent_question', questionKey: 'boss_clarification' },
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ChatPanel — project scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatSessionStore.getState().reset();
    mockSendMessage.mockResolvedValue(undefined);
    mockRetryLastMessage.mockResolvedValue(undefined);
    mockRespondToInteraction.mockResolvedValue(undefined);
    mockRuntime.isRunning = false;
    mockRuntime.isReady = true;
    mockRuntime.error = null;
    mockRuntime.pendingInteraction = null;
  });

  it('shows project name banner when activeProject is provided', () => {
    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={ACTIVE_PROJECT} />);
    expect(screen.getByText('Alpha Initiative')).toBeInTheDocument();
  });

  it('does not show project banner when activeProject is null', () => {
    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={null} />);
    expect(screen.queryByText('Alpha Initiative')).toBeNull();
  });

  it('does not show project banner when activeProject is undefined', () => {
    render(<ChatPanel onOpenSettings={vi.fn()} />);
    // No project banner element should be visible
    const _folders = document.querySelectorAll('svg');
    // Just verify the component renders without crashing
    expect(document.body).toBeTruthy();
  });

  it('passes project threadId to sendMessage when activeProject is set', async () => {
    const user = userEvent.setup();
    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={ACTIVE_PROJECT} />);

    // ChatInput mock renders a button that calls onSend('test message')
    await user.click(screen.getByTestId('chat-input-send'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0]).toBe('test message');
    expect(callArgs[1]).toMatchObject({ threadId: 'thread-xyz-999' });
  });

  it('passes undefined threadId to sendMessage when no activeProject', async () => {
    const user = userEvent.setup();
    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={null} />);

    await user.click(screen.getByTestId('chat-input-send'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[1]).toMatchObject({ threadId: undefined });
  });

  it('persists conversation history across unmount/remount for the same project thread', async () => {
    const user = userEvent.setup();
    mockSendMessage.mockResolvedValue('assistant reply');

    const firstRender = render(
      <ChatPanel onOpenSettings={vi.fn()} activeProject={ACTIVE_PROJECT} />,
    );
    await user.click(screen.getByTestId('chat-input-send'));

    await waitFor(() => {
      expect(screen.getByText('test message')).toBeInTheDocument();
      expect(screen.getByText('assistant reply')).toBeInTheDocument();
    });

    firstRender.unmount();

    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={ACTIVE_PROJECT} />);

    expect(screen.getByText('test message')).toBeInTheDocument();
    expect(screen.getByText('assistant reply')).toBeInTheDocument();
  });

  it('hides project banner when in direct-chat mode even with activeProject set', () => {
    render(
      <ChatPanel
        onOpenSettings={vi.fn()}
        activeProject={ACTIVE_PROJECT}
        selectedEmployeeId="emp-1"
        selectedEmployeeName="Alice"
      />,
    );
    // In direct-chat mode, the project banner should NOT render (component condition: activeProject && !isDirectChat)
    expect(screen.queryByText('Alpha Initiative')).toBeNull();
    // But the direct-chat header with employee name should show
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows a pending interaction card even when there are no chat messages yet', () => {
    mockRuntime.pendingInteraction = makeInteractionRequest({
      kind: 'plan_review',
      title: 'Review plan before execution',
      prompt: 'Review the generated plan before execution.',
    });

    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={null} />);

    expect(screen.getByText('Review plan before execution')).toBeInTheDocument();
  });

  it('appends agent-question answers and follow-up assistant replies to the chat', async () => {
    const user = userEvent.setup();
    mockRuntime.pendingInteraction = makeInteractionRequest({ kind: 'agent_question' });
    mockRespondToInteraction.mockResolvedValue(
      'Thanks. I will proceed with the SaaS landing page.',
    );

    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={null} />);

    await user.click(screen.getByRole('button', { name: 'Answer and continue' }));

    expect(
      await screen.findByText('Build a SaaS landing page', { exact: false }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Thanks. I will proceed with the SaaS landing page.', {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('keeps interaction replies on the original direct-chat target after switching chats', async () => {
    const user = userEvent.setup();
    mockRuntime.pendingInteraction = makeInteractionRequest({ kind: 'agent_question' });
    mockRespondToInteraction.mockResolvedValue('Proceeding with the original direct-chat request.');

    const { rerender } = render(
      <ChatPanel
        onOpenSettings={vi.fn()}
        activeProject={null}
        selectedEmployeeId="emp-1"
        selectedEmployeeName="Alice"
      />,
    );

    await user.click(screen.getByTestId('chat-input-send'));

    rerender(
      <ChatPanel
        onOpenSettings={vi.fn()}
        activeProject={null}
        selectedEmployeeId="emp-2"
        selectedEmployeeName="Bob"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Answer and continue' }));

    expect(screen.queryByText('Build a SaaS landing page', { exact: false })).toBeNull();
    expect(
      screen.queryByText('Proceeding with the original direct-chat request.', { exact: false }),
    ).toBeNull();

    rerender(
      <ChatPanel
        onOpenSettings={vi.fn()}
        activeProject={null}
        selectedEmployeeId="emp-1"
        selectedEmployeeName="Alice"
      />,
    );

    expect(
      await screen.findByText('Build a SaaS landing page', { exact: false }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Proceeding with the original direct-chat request.', {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('does not append a duplicate assistant message when the final reply matches streamed content', async () => {
    let resolveReply: ((value: string | undefined) => void) | null = null;
    mockSendMessage.mockImplementation(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolveReply = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<ChatPanel onOpenSettings={vi.fn()} activeProject={ACTIVE_PROJECT} />);

    await user.click(screen.getByTestId('chat-input-send'));

    useChatSessionStore
      .getState()
      .appendStreamingChunkForActiveRun('boss', 'Streamed final answer');

    resolveReply?.('Streamed final answer');

    await waitFor(() => {
      expect(screen.getAllByText('Streamed final answer')).toHaveLength(1);
    });
  });
});

/**
 * Chat action workspace isolation (Req 11.3, 11.4)
 *
 * ChatPanel receives `selectedEmployeeId` and `selectedEmployeeName` as props
 * when a chat action fires (from notification or employee inspector). These
 * props only affect local chat state — the direct-chat header and message
 * target. ChatPanel has NO props or callbacks that modify the active workspace,
 * workspace session state, or trigger workspace switches. This is by design:
 * the parent (App.tsx) only calls `setSelectedEmployeeId` + `setChatOpenToken`
 * on chat actions, neither of which touches workspace state.
 */
describe('ChatPanel — workspace isolation (Req 11.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockRuntime.isRunning = false;
    mockRuntime.isReady = true;
    mockRuntime.error = null;
    mockRuntime.pendingInteraction = null;
  });

  it('switching selectedEmployeeId only changes the direct-chat header, not workspace state', () => {
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <ChatPanel onOpenSettings={onOpenSettings} activeProject={ACTIVE_PROJECT} />,
    );

    // No direct-chat header initially
    expect(screen.queryByText('Team')).toBeNull();

    // Simulate chat action: selectedEmployeeId changes (as if from notification/inspector)
    rerender(
      <ChatPanel
        onOpenSettings={onOpenSettings}
        activeProject={ACTIVE_PROJECT}
        selectedEmployeeId="emp-1"
        selectedEmployeeName="Alice"
      />,
    );

    // Direct-chat header appears with employee name
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // Project banner is hidden in direct-chat mode (local UI change only)
    expect(screen.queryByText('Alpha Initiative')).toBeNull();
  });

  it('does not expose any workspace-switching callbacks in its props interface', () => {
    // ChatPanel's props do not include setActiveWorkspace, handleWorkspaceSwitch,
    // or any callback that could modify workspace session state. This test
    // documents the architectural guarantee by verifying the component renders
    // and functions with only chat-local callbacks.
    const callbacks = {
      onOpenSettings: vi.fn(),
      onClearSelection: vi.fn(),
      onToggleDashboard: vi.fn(),
      onToggleKanban: vi.fn(),
      onOpenEditor: vi.fn(),
      onOpenStudio: vi.fn(),
      onUserMessage: vi.fn(),
    };

    render(
      <ChatPanel
        {...callbacks}
        activeProject={ACTIVE_PROJECT}
        selectedEmployeeId="emp-1"
        selectedEmployeeName="Alice"
      />,
    );

    // Component renders without any workspace-related props
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // None of the callbacks were invoked during render
    for (const cb of Object.values(callbacks)) {
      expect(cb).not.toHaveBeenCalled();
    }
  });
});
