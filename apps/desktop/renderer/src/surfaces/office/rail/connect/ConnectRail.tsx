// Office company channels. Direct + group daily chat over the
// PR-02 CollaborationService and the PR-03 turn controller, FULLY isolated from
// the project-scoped `chat_threads` / Office work path. This surface NEVER reads
// `useWsConversations` / `useWsThread`, never calls `conversationRunController`,
// and never opens a thread in Office.
//
// Flows: Contacts → Message (direct draft → getOrCreateDirect on first send,
// idempotent); New chat (Direct picker | New group dialog); group mentions-only
// (no auto-fire; Ask team) + roundtable (Start / Continue round, bounded); the
// PR-01 single-pending invariant per active speaker turn; unread / archive / time.

import type { CompanyThreadDraft } from '@/app/ui-state.js';
import { displayThreadTitle } from '@/data/adapters.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { generateId } from '@offisim/core/browser';
import type { CollaborationThreadSummary } from '@offisim/core/browser';
import type { CollaborationMessage } from '@offisim/shared-types';
import { MessageSquare, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AskTeamDialog,
  DirectPickerDialog,
  GroupMembersDialog,
  type NewChatKind,
  NewChatTypeDialog,
  NewGroupDialog,
} from './ConnectDialogs.js';
import { DraftThreadDetail, PersistedThreadDetail } from './ThreadDetailShell.js';
import { ThreadRow } from './ThreadRow.js';
import {
  useArchiveThread,
  useConnectMembers,
  useConnectThreads,
  useCreateGroup,
  useGetOrCreateDirect,
  useMarkRead,
  useUpdateMembers,
  useUpdateThreadProfile,
} from './collaboration-data.js';
import { type NewGroupSubmission, submitNewGroupFromDialog } from './new-group-submit.js';
import { useConnectRuntime } from './use-connect-runtime.js';

/* ── Surface ──────────────────────────────────────────────────────────────── */

export function ConnectRail({
  mode,
  companyId,
  selectedId,
  draft,
  onOpenThread,
  onOpenDraft,
  onBack,
}: {
  mode: 'list' | 'detail';
  companyId: string | null;
  selectedId: string | null;
  draft: CompanyThreadDraft | null;
  onOpenThread: (threadId: string) => void;
  onOpenDraft: (draft: CompanyThreadDraft) => void;
  onBack: () => void;
}) {
  const employees = useEmployees();
  const threads = useConnectThreads(companyId);
  const [query, setQuery] = useState('');

  // Dialogs
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [directPickerOpen, setDirectPickerOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [askTeamOpen, setAskTeamOpen] = useState(false);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const list = threads.data ?? [];
  // A persisted thread is active when selected; otherwise a draft owns selection.
  const activeThread = list.find((t) => t.threadId === selectedId) ?? null;
  const activeDraft = draft && draft.id === selectedId ? draft : null;
  const activeThreadId = activeThread?.threadId ?? null;

  const runtime = useConnectRuntime(companyId, activeThreadId);
  const getOrCreateDirect = useGetOrCreateDirect(companyId);
  const createGroup = useCreateGroup(companyId);
  const updateMembers = useUpdateMembers(companyId);
  const archive = useArchiveThread(companyId);
  const updateThreadProfile = useUpdateThreadProfile(companyId);
  const markRead = useMarkRead(companyId);

  // Mark the active persisted thread read when opened / when its latest changes.
  const latestId = activeThread?.lastMessage?.messageId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeThread?.unreadCount is intentionally not re-added (covered by latestId change signal); markRead.mutate is an unmemoized method ref (not added to avoid render loops).
  useEffect(() => {
    if (activeThreadId && latestId && (activeThread?.unreadCount ?? 0) > 0) {
      markRead.mutate({ threadId: activeThreadId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, latestId]);

  const titleFor = (thread: CollaborationThreadSummary): string => {
    if (thread.kind === 'direct') {
      const emp = thread.directEmployeeId ? byId.get(thread.directEmployeeId) : null;
      return emp?.name ?? displayThreadTitle(thread.title);
    }
    return displayThreadTitle(thread.title);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: titleFor is an unmemoized function ref (not added to avoid render loops); byId is the memoized backing map already tracked.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => {
      const title = titleFor(t).toLowerCase();
      const snip = (t.lastMessage?.body ?? '').toLowerCase();
      return title.includes(q) || snip.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query, byId]);

  const directThreads = filtered.filter((t) => !t.archivedAt);
  const archivedThreads = filtered.filter((t) => t.archivedAt);

  /* ── New chat actions ─────────────────────────────────────────────────── */

  function startDirectDraft(employee: Employee): void {
    const id = generateId('thread');
    onOpenDraft({ kind: 'direct', id, employeeId: employee.id, employeeName: employee.name });
    setDirectPickerOpen(false);
    setNewChatOpen(false);
  }

  async function createGroupFromDialog(input: NewGroupSubmission): Promise<void> {
    await submitNewGroupFromDialog(input, {
      createGroup: (payload) => createGroup.mutateAsync(payload),
      openThread: onOpenThread,
      closeDialog: () => {
        setNewGroupOpen(false);
        setNewChatOpen(false);
      },
    });
  }

  function onNewChatPick(kind: NewChatKind): void {
    setNewChatOpen(false);
    if (kind === 'direct') setDirectPickerOpen(true);
    else setNewGroupOpen(true);
  }

  let detailBody: ReactNode;
  if (activeThread) {
    detailBody = (
      <PersistedThreadDetail
        thread={activeThread}
        title={titleFor(activeThread)}
        byId={byId}
        runtime={runtime}
        onArchiveToggle={() =>
          archive.mutate({
            threadId: activeThread.threadId,
            archived: !activeThread.archivedAt,
          })
        }
        onProfileToggle={() =>
          updateThreadProfile.mutate({
            threadId: activeThread.threadId,
            capabilityProfile:
              activeThread.capabilityProfile === 'collaboration_read'
                ? 'strict'
                : 'collaboration_read',
          })
        }
        onOpenMembers={() => setMembersOpen(true)}
        onOpenAskTeam={() => setAskTeamOpen(true)}
        onBack={onBack}
      />
    );
  } else if (activeDraft) {
    detailBody = (
      <DraftThreadDetail
        draft={activeDraft}
        byId={byId}
        onSend={async (body) => {
          if (activeDraft.kind === 'direct') {
            const threadId = await getOrCreateDirect.mutateAsync({
              employeeId: activeDraft.employeeId,
              title: activeDraft.employeeName,
            });
            await runtime.send(threadId, body);
            onOpenThread(threadId);
          } else {
            const threadId = await createGroup.mutateAsync({
              title: activeDraft.title,
              employeeIds: activeDraft.employeeIds,
              replyPolicy: activeDraft.replyPolicy,
            });
            await runtime.send(threadId, body);
            onOpenThread(threadId);
          }
        }}
        onBack={onBack}
      />
    );
  } else {
    detailBody = (
      <EmptyState
        icon={MessageSquare}
        title="Select a chat"
        description="Pick a conversation, or start a new one."
      />
    );
  }

  const activeMembers = useConnectMembers(membersOpen ? activeThreadId : null);
  const memberViews = (activeMembers.data ?? [])
    .filter((m) => m.actorType === 'employee')
    .map((m) => ({
      memberId: m.memberId,
      employeeId: m.employeeId ?? null,
      name: m.employeeId ? (byId.get(m.employeeId)?.name ?? 'Member') : 'Member',
    }));
  const askTeamMembers = useConnectMembers(askTeamOpen ? activeThreadId : null);
  const askTeamEmployees = (askTeamMembers.data ?? [])
    .filter((m) => m.actorType === 'employee' && m.employeeId)
    .map((m) => byId.get(m.employeeId as string))
    .filter((e): e is Employee => e != null);
  const unread = list.reduce((sum, thread) => sum + thread.unreadCount, 0);

  return (
    <>
      {mode === 'list' ? (
        <div className="off-company-channel-list">
          <div className="off-ws-list-head">
            <span className="off-ws-list-title">
              Company channels
              {unread > 0 ? <span className="off-ws-im-nb">{unread}</span> : null}
            </span>
            <button
              type="button"
              className="off-ws-list-add off-focusable"
              title="New chat"
              onClick={() => setNewChatOpen(true)}
            >
              <Icon icon={Plus} size="sm" />
            </button>
          </div>
          <div className="off-ws-list-search">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search people, groups, messages"
            />
          </div>
          <div className="off-ws-chats">
            {threads.isError && list.length === 0 ? (
              <ErrorState
                title="Couldn't load chats"
                detail={errorDetail(threads.error, 'Your conversations failed to load.')}
                onRetry={() => void threads.refetch()}
              />
            ) : null}
            {!threads.isError && list.length === 0 && !threads.isLoading ? (
              <div className="off-connect-list-empty">
                {(employees.data ?? []).length === 0 ? (
                  'Hire an employee to start chatting.'
                ) : (
                  <>
                    <span>No chats yet.</span>
                    <Button variant="outline" size="sm" onClick={() => setNewChatOpen(true)}>
                      <Icon icon={Plus} size="sm" />
                      New chat
                    </Button>
                  </>
                )}
              </div>
            ) : null}
            {directThreads.map((thread) => (
              <ThreadRow
                key={thread.threadId}
                thread={thread}
                title={titleFor(thread)}
                employee={
                  thread.directEmployeeId ? (byId.get(thread.directEmployeeId) ?? null) : null
                }
                active={thread.threadId === selectedId}
                onSelect={() => onOpenThread(thread.threadId)}
              />
            ))}
            {archivedThreads.length > 0 ? (
              <>
                <div className="off-ws-im-sec">Archived</div>
                {archivedThreads.map((thread) => (
                  <ThreadRow
                    key={thread.threadId}
                    thread={thread}
                    title={titleFor(thread)}
                    employee={
                      thread.directEmployeeId ? (byId.get(thread.directEmployeeId) ?? null) : null
                    }
                    active={thread.threadId === selectedId}
                    onSelect={() => onOpenThread(thread.threadId)}
                  />
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="off-company-channel-detail">{detailBody}</div>
      )}

      <NewChatTypeDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onPick={onNewChatPick}
      />
      <DirectPickerDialog
        open={directPickerOpen}
        employees={employees.data ?? []}
        onClose={() => setDirectPickerOpen(false)}
        onPick={startDirectDraft}
      />
      <NewGroupDialog
        open={newGroupOpen}
        employees={employees.data ?? []}
        busy={createGroup.isPending}
        onClose={() => setNewGroupOpen(false)}
        onCreate={createGroupFromDialog}
      />
      {activeThread && activeThread.kind === 'group' ? (
        <GroupMembersDialog
          open={membersOpen}
          title={titleFor(activeThread)}
          policy={activeThread.replyPolicy}
          members={memberViews}
          employees={employees.data ?? []}
          busy={updateMembers.isPending}
          onClose={() => setMembersOpen(false)}
          onApply={({ addEmployeeIds, removeMemberIds }) => {
            updateMembers.mutate(
              { threadId: activeThread.threadId, addEmployeeIds, removeMemberIds },
              { onSuccess: () => setMembersOpen(false) },
            );
          }}
        />
      ) : null}
      {activeThread && activeThread.kind === 'group' ? (
        <AskTeamDialog
          open={askTeamOpen}
          employees={askTeamEmployees}
          onClose={() => setAskTeamOpen(false)}
          onAsk={(responderEmployeeIds) => {
            const trigger = activeThread.lastMessage;
            setAskTeamOpen(false);
            if (trigger)
              void runtime.askTeam(
                activeThread.threadId,
                toRuntimeMessage(trigger),
                responderEmployeeIds,
              );
          }}
        />
      ) : null}
    </>
  );
}

/** Project a persisted summary's last message into the controller's message shape
 *  (Ask team / round triggers reference the last boss message). */
function toRuntimeMessage(
  message: NonNullable<CollaborationThreadSummary['lastMessage']>,
): CollaborationMessage {
  return message;
}
