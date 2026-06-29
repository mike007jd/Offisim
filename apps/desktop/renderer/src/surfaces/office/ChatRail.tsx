import { useUiState } from '@/app/ui-state.js';
import { OfficeThread } from '@/assistant/OfficeThread.js';
import { reposOrNull } from '@/data/adapters.js';
import { deriveThreadTitle } from '@/data/auto-title.js';
import {
  useDeliverables,
  useEmployees,
  useMessages,
  useProjects,
  useThreads,
} from '@/data/queries.js';
import type { ChatAttachment, ChatMessage, ChatThread } from '@/data/types.js';
import { useDeliverableRefresh } from '@/data/use-deliverable-refresh.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import {
  type WsAttachment,
  type WsConversation,
  type WsMessage,
  useWsConversations,
  useWsThread,
} from '@/surfaces/workspace/workspace-data.js';
import {
  persistWorkspaceMessage,
  usePersistedWorkspaceMessages,
} from '@/surfaces/workspace/workspace-message-events.js';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronsLeft, ChevronsRight, Inbox, MessageSquare, Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { ConversationActionsMenu } from './rail/ConversationActionsMenu.js';
import { ThreadList } from './rail/ThreadList.js';

function extensionFromName(name: string): string {
  const [, ext] = /\.([^.]+)$/.exec(name) ?? [];
  return ext ? ext.toUpperCase() : 'FILE';
}

function wsAttachmentToChatAttachment(attachment: WsAttachment): ChatAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    ext: extensionFromName(attachment.name),
    sizeLabel: attachment.meta,
  };
}

function workspaceTimeLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function wsMessageTime(label: string, index: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label);
  const at = new Date();
  if (match) {
    at.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (at.getTime() > Date.now()) at.setDate(at.getDate() - 1);
    return at.getTime();
  }
  return Date.now() - Math.max(0, 50 - index) * 60_000;
}

function wsMessageToChatMessage(message: WsMessage, threadId: string, index: number): ChatMessage {
  const attachments: ChatAttachment[] = [];
  if (message.attachment) attachments.push(wsAttachmentToChatAttachment(message.attachment));
  if (message.deliverable) {
    attachments.push({
      id: message.deliverable.id,
      name: message.deliverable.title,
      ext: message.deliverable.format,
      sizeLabel: message.deliverable.meta,
    });
  }
  return {
    id: message.id,
    threadId,
    author: message.author,
    employeeId: message.employeeId,
    body: message.body,
    reasoning: message.reasoning,
    at: wsMessageTime(message.timeLabel, index),
    attachments: attachments.length ? attachments : undefined,
  };
}

function mergeWsMessages(...sources: WsMessage[][]): WsMessage[] {
  const merged = new Map<string, WsMessage>();
  for (const source of sources) {
    for (const message of source) {
      merged.set(message.id, message);
    }
  }
  return Array.from(merged.values());
}

function chatMessageToWsMessage(message: ChatMessage, conversation: WsConversation): WsMessage {
  const firstAttachment = message.attachments?.[0];
  return {
    id: message.id,
    author: message.author === 'boss' ? 'boss' : 'employee',
    employeeId: message.author === 'boss' ? null : (message.employeeId ?? conversation.employeeId),
    role: conversation.kind === 'group' ? 'workspace' : undefined,
    timeLabel: workspaceTimeLabel(new Date(message.at)),
    body: message.body,
    reasoning: message.reasoning,
    attachment: firstAttachment
      ? {
          id: firstAttachment.id,
          name: firstAttachment.name,
          meta:
            message.attachments && message.attachments.length > 1
              ? `${firstAttachment.sizeLabel} · ${message.attachments.length} files staged`
              : firstAttachment.sizeLabel,
        }
      : undefined,
  };
}

export function ChatRail() {
  const railMode = useUiState((s) => s.railMode);
  const collapsed = useUiState((s) => s.officeRightRailCollapsed);
  const setCollapsed = useUiState((s) => s.setOfficeRightRailCollapsed);
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const draftThread = useUiState((s) => s.draftThread);
  const openDraftThread = useUiState((s) => s.openDraftThread);
  const markDraftPersisted = useUiState((s) => s.markDraftPersisted);
  const closeThread = useUiState((s) => s.closeThread);
  const setSurface = useUiState((s) => s.setSurface);
  const setWorkspaceApp = useUiState((s) => s.setWorkspaceApp);
  const queryClient = useQueryClient();

  const threads = useThreads(projectId);
  const projects = useProjects(companyId);
  const employees = useEmployees();
  const messages = useMessages(railMode === 'thread' ? selectedThreadId : null);
  const deliverables = useDeliverables(railMode === 'thread' ? selectedThreadId : null);
  useDeliverableRefresh(railMode === 'thread' ? selectedThreadId : null);
  const workspaceConversations = useWsConversations();

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
      await queryClient.invalidateQueries({ queryKey: ['threads', projectId] });
      toast.success('Conversation created');
    },
    [projectId, selectedThreadId, employeesById, markDraftPersisted, queryClient],
  );

  const activeWorkspaceConversation = workspaceConversations.data?.find(
    (c) => c.id === selectedThreadId && c.kind !== 'system',
  );
  const workspaceThread = useWsThread(
    !activeThread && activeWorkspaceConversation ? selectedThreadId : null,
  );
  const persistedWorkspaceMessages = usePersistedWorkspaceMessages(
    !activeThread && activeWorkspaceConversation ? selectedThreadId : null,
  );
  const workspaceMessages = useMemo(
    () =>
      mergeWsMessages(workspaceThread.data?.messages ?? [], persistedWorkspaceMessages.data ?? []),
    [workspaceThread.data?.messages, persistedWorkspaceMessages.data],
  );
  const workspaceSeedMessages = useMemo(
    () =>
      selectedThreadId
        ? workspaceMessages.map((message, index) =>
            wsMessageToChatMessage(message, selectedThreadId, index),
          )
        : [],
    [selectedThreadId, workspaceMessages],
  );
  const persistWorkspaceChatMessage = useMemo(
    () =>
      !activeThread && activeWorkspaceConversation && selectedThreadId
        ? (message: ChatMessage) =>
            persistWorkspaceMessage({
              threadId: selectedThreadId,
              message: chatMessageToWsMessage(message, activeWorkspaceConversation),
              companyId,
              projectId,
            })
        : undefined,
    [activeThread, activeWorkspaceConversation, companyId, projectId, selectedThreadId],
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
          employeeId: draftThread?.employeeId ?? null,
          updatedAt: Date.now(),
        }
      : null;
  const displayThread: ChatThread | null =
    activeThread ??
    draftDisplayThread ??
    (activeWorkspaceConversation && selectedThreadId
      ? {
          id: selectedThreadId,
          projectId: projectId ?? '',
          title: activeWorkspaceConversation.title,
          subtitle:
            activeWorkspaceConversation.kind === 'group'
              ? `Team conversation · ${activeWorkspaceConversation.members ?? 0} members`
              : activeWorkspaceConversation.snippet,
          scope: activeWorkspaceConversation.kind === 'group' ? 'team' : 'direct',
          runState: 'idle' as const,
          employeeId: activeWorkspaceConversation.employeeId,
          updatedAt: Date.now(),
        }
      : null);
  const projectName = projects.data?.find((p) => p.id === projectId)?.name ?? 'Project';

  if (collapsed) {
    return (
      <section className="off-rail is-collapsed" aria-label="Conversations">
        <button
          type="button"
          className="off-rail-collapse-btn off-focusable"
          onClick={() => setCollapsed(false)}
          title="Expand conversations"
        >
          <Icon icon={ChevronsLeft} size="sm" />
        </button>
        <button
          type="button"
          className="off-rail-icon-tab off-focusable is-active"
          onClick={() => setCollapsed(false)}
          title={railMode === 'thread' ? 'Open conversation' : 'Open conversations'}
        >
          <Icon icon={railMode === 'thread' ? MessageSquare : Inbox} size="sm" />
          <span>{railMode === 'thread' ? 'Thread' : 'Chats'}</span>
        </button>
        <button
          type="button"
          className="off-rail-icon-tab off-focusable"
          onClick={() => {
            setCollapsed(false);
            openDraftThread(null);
          }}
          title="New conversation"
        >
          <Icon icon={Plus} size="sm" />
          <span>New</span>
        </button>
      </section>
    );
  }

  if (railMode === 'list') {
    return (
      <section className="off-rail is-list" aria-label="Conversations">
        <button
          type="button"
          className="off-rail-collapse-edge off-focusable"
          onClick={() => setCollapsed(true)}
          title="Collapse conversations"
        >
          <Icon icon={ChevronsRight} size="sm" />
        </button>
        <ThreadList />
      </section>
    );
  }

  if (!selectedThreadId) {
    // Thread mode without a selection is an empty state, not a loading state —
    // skeletons would never resolve (no query is pending). No conversation
    // header either: there is no thread to title or open in Inbox.
    return (
      <section className="off-rail" aria-label="Conversation">
        <button
          type="button"
          className="off-rail-collapse-edge off-focusable"
          onClick={() => setCollapsed(true)}
          title="Collapse conversations"
        >
          <Icon icon={ChevronsRight} size="sm" />
        </button>
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
    <section className="off-rail" aria-label="Conversation">
      <button
        type="button"
        className="off-rail-collapse-edge off-focusable"
        onClick={() => setCollapsed(true)}
        title="Collapse conversations"
      >
        <Icon icon={ChevronsRight} size="sm" />
      </button>
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
        <IconButton
          icon={Inbox}
          label="Open in Inbox"
          variant="ghost"
          size="icon"
          onClick={() => {
            setWorkspaceApp('messenger', selectedThreadId);
            setSurface('workspace');
          }}
        />
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

      {(
        activeThread
          ? messages.isLoading
          : workspaceThread.isLoading || persistedWorkspaceMessages.isLoading
      ) ? (
        <SkeletonRows rows={4} />
      ) : (
          activeThread
            ? messages.isError
            : workspaceThread.isError || persistedWorkspaceMessages.isError
        ) ? (
        <ErrorState
          title="Couldn't load this conversation"
          detail={errorDetail(
            activeThread
              ? messages.error
              : (workspaceThread.error ?? persistedWorkspaceMessages.error),
            'The messages failed to load.',
          )}
          onRetry={() => {
            if (activeThread) void messages.refetch();
            else {
              void workspaceThread.refetch();
              void persistedWorkspaceMessages.refetch();
            }
          }}
        />
      ) : (
        <OfficeThread
          key={selectedThreadId}
          threadId={selectedThreadId}
          companyId={companyId}
          projectId={projectId}
          runState={displayThread?.runState ?? 'idle'}
          seedMessages={activeThread ? (messages.data ?? []) : workspaceSeedMessages}
          employeesById={employeesById}
          deliverables={deliverables.data ?? []}
          employeeId={displayThread?.employeeId ?? null}
          isDraft={isDraft}
          projectName={projectName}
          persistMessage={persistWorkspaceChatMessage}
          materializeThread={isDraft ? materializeThread : undefined}
        />
      )}
    </section>
  );
}
