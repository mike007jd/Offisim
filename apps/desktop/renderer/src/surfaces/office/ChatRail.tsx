import { useUiState } from '@/app/ui-state.js';
import { OfficeThread } from '@/assistant/OfficeThread.js';
import {
  useDeliverables,
  useEmployees,
  useMessages,
  useProjects,
  useThreads,
} from '@/data/queries.js';
import type { ChatAttachment, ChatMessage, ChatThread } from '@/data/types.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
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
import { ChevronLeft, Inbox } from 'lucide-react';
import { useMemo } from 'react';
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
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const closeThread = useUiState((s) => s.closeThread);
  const setSurface = useUiState((s) => s.setSurface);
  const setWorkspaceApp = useUiState((s) => s.setWorkspaceApp);

  const threads = useThreads(projectId);
  const projects = useProjects(companyId);
  const employees = useEmployees();
  const messages = useMessages(railMode === 'thread' ? selectedThreadId : null);
  const deliverables = useDeliverables(railMode === 'thread' ? selectedThreadId : null);
  const workspaceConversations = useWsConversations();

  const employeesById = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const activeThread = threads.data?.find((t) => t.id === selectedThreadId);
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
  const displayThread: ChatThread | null =
    activeThread ??
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

  if (railMode === 'list') {
    return (
      <section className="off-rail is-list" aria-label="Conversations">
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
          projectName={projectName}
          persistMessage={persistWorkspaceChatMessage}
        />
      )}
    </section>
  );
}
