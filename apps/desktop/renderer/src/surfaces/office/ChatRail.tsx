import { useUiState } from '@/app/ui-state.js';
import { OfficeThread } from '@/assistant/OfficeThread.js';
import { reposOrNull } from '@/data/adapters.js';
import { deriveThreadTitle } from '@/data/auto-title.js';
import { queryKeys } from '@/data/query-keys.js';
import {
  useDeliverables,
  useEmployees,
  useMessages,
  useProjects,
  useThreads,
} from '@/data/queries.js';
import type { ChatThread } from '@/data/types.js';
import { useDeliverableRefresh } from '@/data/use-deliverable-refresh.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Inbox } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { ConversationActionsMenu } from './rail/ConversationActionsMenu.js';
import { ThreadList } from './rail/ThreadList.js';
import { ConnectRail } from './rail/connect/ConnectRail.js';

export function ChatRail() {
  const railMode = useUiState((s) => s.railMode);
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const selectedCompanyThreadId = useUiState((s) => s.selectedCompanyThreadId);
  const companyThreadDraft = useUiState((s) => s.companyThreadDraft);
  const draftThread = useUiState((s) => s.draftThread);
  const markDraftPersisted = useUiState((s) => s.markDraftPersisted);
  const closeThread = useUiState((s) => s.closeThread);
  const pendingThreadFocus = useUiState((s) => s.pendingThreadFocus);
  const focusedMessageId = useUiState((s) => s.focusedMessageId);
  const consumePendingThreadFocus = useUiState((s) => s.consumePendingThreadFocus);
  const clearFocusedMessage = useUiState((s) => s.clearFocusedMessage);
  const openThread = useUiState((s) => s.openThread);
  const openCompanyThread = useUiState((s) => s.openCompanyThread);
  const openCompanyDraft = useUiState((s) => s.openCompanyDraft);
  const queryClient = useQueryClient();

  const threads = useThreads(projectId);
  const projects = useProjects(companyId);
  const employees = useEmployees();
  const messages = useMessages(railMode === 'thread' ? selectedThreadId : null);
  const deliverables = useDeliverables(railMode === 'thread' ? selectedThreadId : null);
  useDeliverableRefresh(railMode === 'thread' ? selectedThreadId : null);

  useEffect(() => {
    if (!pendingThreadFocus) return;
    if (pendingThreadFocus.projectId !== projectId) {
      consumePendingThreadFocus();
      return;
    }
    if (!threads.isSuccess) return;
    const intent = consumePendingThreadFocus();
    if (!intent) return;
    if (threads.data?.some((thread) => thread.id === intent.threadId)) {
      openThread(intent.threadId, intent.messageId);
      return;
    }
    toast.error('The source conversation no longer exists in this project.');
  }, [
    consumePendingThreadFocus,
    openThread,
    pendingThreadFocus,
    projectId,
    threads.data,
    threads.isSuccess,
  ]);

  const employeesById = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const activeThread = threads.data?.find((t) => t.id === selectedThreadId);
  const isDraft = !!draftThread && draftThread.id === selectedThreadId && !activeThread;
  const draftEmployee = draftThread?.employeeId
    ? employeesById.get(draftThread.employeeId)
    : undefined;

  // Materialize a draft conversation on its first message: insert the
  // `chat_threads` row (titled from that message for a team draft, or after the
  // employee for a direct draft), drop the draft flag, and refresh the list so
  // the now-real conversation appears — already titled, never as an empty
  // "New conversation". Guarded against double-send via a fresh store read.
  const materializeThread = useCallback(
    async (firstUserText: string) => {
      if (!projectId || !selectedThreadId) return;
      const draft = useUiState.getState().draftThread;
      if (!draft || draft.id !== selectedThreadId) return;
      const repos = await reposOrNull();
      if (!repos) return;
      if (!(await repos.chatThreads.findById(selectedThreadId))) {
        const title = draft.employeeId
          ? `Chat with ${employeesById.get(draft.employeeId)?.name ?? 'teammate'}`
          : (deriveThreadTitle(firstUserText) ?? 'New thread');
        await repos.chatThreads.create({
          thread_id: selectedThreadId,
          project_id: projectId,
          employee_id: draft.employeeId,
          title,
        });
      }
      markDraftPersisted();
      await queryClient.invalidateQueries({ queryKey: queryKeys.threads(projectId) });
      toast.success('Conversation created');
    },
    [projectId, selectedThreadId, employeesById, markDraftPersisted, queryClient],
  );

  const draftDisplayThread: ChatThread | null =
    isDraft && selectedThreadId
      ? {
          id: selectedThreadId,
          projectId: projectId ?? '',
          title: draftEmployee ? `Chat with ${draftEmployee.name}` : 'New conversation',
          subtitle: draftEmployee ? (draftEmployee.role ?? 'Direct message') : 'Team conversation',
          scope: draftEmployee ? 'direct' : 'team',
          runState: 'idle' as const,
          runtimeStatus: null,
          employeeId: draftThread?.employeeId ?? null,
          updatedAt: Date.now(),
        }
      : null;
  const displayThread: ChatThread | null = activeThread ?? draftDisplayThread;
  const projectName = projects.data?.find((p) => p.id === projectId)?.name ?? 'Project';

  if (railMode === 'list') {
    return (
      <section
        id="office-conversation-rail"
        className="off-rail is-list"
        aria-label="Conversations"
      >
        <ThreadList />
      </section>
    );
  }

  if (selectedCompanyThreadId) {
    return (
      <section
        id="office-conversation-rail"
        className="off-rail off-company-channel-rail"
        aria-label="Company channel"
      >
        <ConnectRail
          mode="detail"
          companyId={companyId || null}
          selectedId={selectedCompanyThreadId}
          draft={companyThreadDraft}
          onOpenThread={openCompanyThread}
          onOpenDraft={openCompanyDraft}
          onBack={closeThread}
        />
      </section>
    );
  }

  if (!selectedThreadId) {
    // Thread mode without a selection is an empty state, not a loading state —
    // skeletons would never resolve (no query is pending). No conversation
    // header either: there is no thread to title or open in Inbox.
    return (
      <section id="office-conversation-rail" className="off-rail" aria-label="Conversation">
        <EmptyState
          icon={Inbox}
          title="No conversation open"
          description="Pick a conversation to see its messages here."
          action={{ label: 'Browse conversations', onClick: closeThread }}
        />
      </section>
    );
  }

  return (
    <section id="office-conversation-rail" className="off-rail" aria-label="Conversation">
      <header className="off-chat-head">
        <IconButton
          icon={ChevronLeft}
          label="Back to conversations"
          variant="ghost"
          size="icon"
          onClick={closeThread}
        />
        <div className="off-chat-crumb">
          <span className="off-chat-title">{displayThread?.title ?? 'Conversation'}</span>
          {displayThread?.subtitle ? (
            <span className="off-chat-sub">{displayThread.subtitle}</span>
          ) : null}
        </div>
        {activeThread ? (
          <ConversationActionsMenu
            thread={activeThread}
            projectId={projectId}
            companyId={companyId}
            onArchived={closeThread}
            onDeleted={closeThread}
          />
        ) : null}
      </header>

      {messages.isLoading ? (
        <SkeletonRows rows={4} />
      ) : messages.isError ? (
        <ErrorState
          title="Couldn't load this conversation"
          detail={errorDetail(messages.error, 'The messages failed to load.')}
          onRetry={() => void messages.refetch()}
        />
      ) : (
        <OfficeThread
          key={selectedThreadId}
          threadId={selectedThreadId}
          companyId={companyId}
          projectId={projectId}
          runState={displayThread?.runState ?? 'idle'}
          seedMessages={messages.data ?? []}
          employeesById={employeesById}
          deliverables={deliverables.data ?? []}
          employeeId={displayThread?.employeeId ?? null}
          isDraft={isDraft}
          projectName={projectName}
          materializeThread={isDraft ? materializeThread : undefined}
          focusedMessageId={focusedMessageId}
          onMessageFocusConsumed={clearFocusedMessage}
        />
      )}
    </section>
  );
}
