import { useUiState } from '@/app/ui-state.js';
import { useThreads } from '@/data/queries.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { RunStatePill } from '@/design-system/grammar/RunStatePill.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { cn, relativeTime } from '@/lib/utils.js';
import { openFirstRunGuide } from '@/surfaces/onboarding/first-run-state.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { MessagesSquare, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConversationActionsMenu } from './ConversationActionsMenu.js';
import { ConnectRail } from './connect/ConnectRail.js';

export function ThreadList() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const selectedCompanyThreadId = useUiState((s) => s.selectedCompanyThreadId);
  const companyThreadDraft = useUiState((s) => s.companyThreadDraft);
  const openThread = useUiState((s) => s.openThread);
  const openCompanyThread = useUiState((s) => s.openCompanyThread);
  const openCompanyDraft = useUiState((s) => s.openCompanyDraft);
  const closeThread = useUiState((s) => s.closeThread);
  // "New conversation" opens a draft (no DB row) instead of inserting an empty
  // thread — the row is created from the first message (ChatRail.materializeThread).
  const openDraftThread = useUiState((s) => s.openDraftThread);
  const threads = useThreads(projectId);
  const [query, setQuery] = useState('');
  const [contextMenuThreadId, setContextMenuThreadId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = threads.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q),
    );
  }, [threads.data, query]);

  return (
    <div className="off-thread-list-groups">
      <div className="off-conv-list-section-head">
        <span className="off-ws-list-title">
          Project conversations
          <span className="off-ws-im-nb">{threads.data?.length ?? 0}</span>
        </span>
        <IconButton
          icon={Plus}
          label="New conversation"
          variant="subtle"
          size="icon"
          disabled={!projectId}
          onClick={() => openDraftThread()}
        />
      </div>
      <div className="off-conv-list-head">
        <SearchInput value={query} onChange={setQuery} placeholder="Search project conversations" />
      </div>

      <div className="off-project-thread-list">
        {threads.isError ? (
          <ErrorState
            title="Couldn't load conversations"
            detail={errorDetail(threads.error, 'Conversations failed to load.')}
            onRetry={() => void threads.refetch()}
          />
        ) : threads.isLoading ? (
          <SkeletonRows rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title={query ? 'No matching conversations' : 'No conversations yet'}
            description={
              query ? 'Try a different search term.' : 'Message the team or one employee.'
            }
            action={
              query
                ? undefined
                : {
                    label: 'Start first request',
                    onClick: openFirstRunGuide,
                  }
            }
          />
        ) : (
          <div className="off-conv-list">
            {filtered.map((thread) => (
              <div
                key={thread.id}
                className={cn(
                  'off-thread-row off-focusable',
                  thread.id === selectedThreadId && 'is-active',
                )}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenuThreadId(thread.id);
                }}
              >
                <button
                  type="button"
                  className="off-thread-main"
                  onClick={() => openThread(thread.id)}
                >
                  <span className="off-thread-info">
                    <span className="off-thread-name">{thread.title}</span>
                    <span
                      className="off-thread-sub"
                      title={new Date(thread.updatedAt).toLocaleString()}
                    >
                      {relativeTime(thread.updatedAt)} · {thread.subtitle}
                    </span>
                  </span>
                  <RunStatePill state={thread.runState} />
                </button>
                <ConversationActionsMenu
                  thread={thread}
                  projectId={projectId}
                  companyId={companyId}
                  open={contextMenuThreadId === thread.id ? true : undefined}
                  onOpenChange={(open) => {
                    if (!open && contextMenuThreadId === thread.id) setContextMenuThreadId(null);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <ConnectRail
        mode="list"
        companyId={companyId || null}
        selectedId={selectedCompanyThreadId}
        draft={companyThreadDraft}
        onOpenThread={openCompanyThread}
        onOpenDraft={openCompanyDraft}
        onBack={closeThread}
      />
    </div>
  );
}
