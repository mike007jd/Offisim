import { useUiState } from '@/app/ui-state.js';
import { OfficeThread } from '@/assistant/OfficeThread.js';
import {
  useDeliverables,
  useEmployees,
  useMessages,
  useProjects,
  useThreads,
} from '@/data/queries.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { ChevronLeft, Inbox } from 'lucide-react';
import { useMemo } from 'react';
import { ThreadList } from './rail/ThreadList.js';

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
  const deliverables = useDeliverables();

  const employeesById = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const activeThread = threads.data?.find((t) => t.id === selectedThreadId);
  const projectName = projects.data?.find((p) => p.id === projectId)?.name ?? 'Project';

  if (railMode === 'list') {
    return (
      <section className="off-rail is-list" aria-label="Conversations">
        <ThreadList />
      </section>
    );
  }

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
        <IconButton
          icon={Inbox}
          label="Open in Inbox"
          variant="ghost"
          size="icon"
          onClick={() => {
            if (selectedThreadId) setWorkspaceApp('messenger', selectedThreadId);
            setSurface('workspace');
          }}
        />
      </header>

      {messages.isLoading || !selectedThreadId ? (
        <SkeletonRows rows={4} />
      ) : (
        <OfficeThread
          key={selectedThreadId}
          threadId={selectedThreadId}
          companyId={companyId}
          projectId={projectId}
          runState={activeThread?.runState ?? 'idle'}
          seedMessages={messages.data ?? []}
          employeesById={employeesById}
          deliverables={deliverables.data ?? []}
          employeeId={activeThread?.employeeId ?? null}
          projectName={projectName}
        />
      )}
    </section>
  );
}
