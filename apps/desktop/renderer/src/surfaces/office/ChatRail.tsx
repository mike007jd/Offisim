import { useUiState } from '@/app/ui-state.js';
import { OfficeThread } from '@/assistant/OfficeThread.js';
import { useDeliverables, useEmployees, useMessages, useThreads } from '@/data/queries.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { ChevronLeft, MessageSquarePlus, MoreHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { ThreadList } from './rail/ThreadList.js';

export function ChatRail() {
  const railMode = useUiState((s) => s.railMode);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const closeThread = useUiState((s) => s.closeThread);

  const threads = useThreads(projectId);
  const employees = useEmployees();
  const messages = useMessages(railMode === 'thread' ? selectedThreadId : null);
  const deliverables = useDeliverables();

  const employeesById = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const activeThread = threads.data?.find((t) => t.id === selectedThreadId);

  if (railMode === 'list') {
    return (
      <section className="off-rail is-list" aria-label="Conversations">
        <ThreadList />
      </section>
    );
  }

  const modelLabel = activeThread?.employeeId
    ? (employeesById.get(activeThread.employeeId)?.modelLabel ?? 'MiniMax-M2.7')
    : 'MiniMax-M2.7';

  return (
    <section className="off-rail" aria-label="Conversation">
      <header className="off-chat-head">
        <IconButton
          icon={ChevronLeft}
          label="Back to threads"
          variant="ghost"
          size="icon"
          onClick={closeThread}
        />
        <div className="off-chat-crumb">
          <span className="off-chat-title">{activeThread?.title ?? 'Conversation'}</span>
          {activeThread?.subtitle ? (
            <span className="off-chat-sub">{activeThread.subtitle}</span>
          ) : null}
        </div>
        <div className="off-chat-head-tools">
          <IconButton icon={MessageSquarePlus} label="New thread" variant="ghost" size="iconSm" />
          <IconButton icon={MoreHorizontal} label="Thread options" variant="ghost" size="iconSm" />
        </div>
      </header>

      {messages.isLoading || !selectedThreadId ? (
        <SkeletonRows rows={4} />
      ) : (
        <OfficeThread
          key={selectedThreadId}
          threadId={selectedThreadId}
          seedMessages={messages.data ?? []}
          employeesById={employeesById}
          deliverables={deliverables.data ?? []}
          scope={activeThread?.scope ?? 'team'}
          modelLabel={modelLabel}
        />
      )}
    </section>
  );
}
