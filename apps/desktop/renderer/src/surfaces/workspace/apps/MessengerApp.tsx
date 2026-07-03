// Connect — the company chat product (PR-05). Direct + group daily chat over the
// PR-02 CollaborationService and the PR-03 turn controller, FULLY isolated from
// the project-scoped `chat_threads` / Office work path. This surface NEVER reads
// `useWsConversations` / `useWsThread`, never calls `conversationRunController`,
// and never opens a thread in Office.
//
// Flows: Contacts → Message (direct draft → getOrCreateDirect on first send,
// idempotent); New chat (Direct picker | New group dialog); group mentions-only
// (no auto-fire; Ask team) + roundtable (Start / Continue round, bounded); the
// PR-01 single-pending invariant per active speaker turn; unread / archive / time.

import { useUiState } from '@/app/ui-state.js';
import { displayThreadTitle } from '@/data/adapters.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { ComposerSettingsMenu } from '@/assistant/composer/ComposerSettingsMenu.js';
import { ChatComposerInput } from '@/design-system/grammar/ChatComposerInput.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn, compactAge } from '@/lib/utils.js';
import { parseMentions } from '@/runtime/collaboration/collaboration-context.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { generateId } from '@offisim/core/browser';
import type { CollaborationThreadSummary } from '@offisim/core/browser';
import type { CollaborationMessage, CollaborationReplyPolicy } from '@offisim/shared-types';
import {
  Archive,
  ArchiveRestore,
  BookOpenCheck,
  MessageSquare,
  Plus,
  RotateCw,
  SendHorizontal,
  Settings2,
  Square,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type ConnectViewMessage,
  useArchiveThread,
  useConnectMembers,
  useConnectMessages,
  useConnectThreads,
  useCreateGroup,
  useGetOrCreateDirect,
  useMarkRead,
  useUpdateThreadProfile,
  useUpdateMembers,
} from '../collaboration-data.js';
import { useConnectRuntime } from '../use-connect-runtime.js';
import {
  AskTeamDialog,
  DirectPickerDialog,
  GroupMembersDialog,
  type NewChatKind,
  NewChatTypeDialog,
  NewGroupDialog,
  policyLabel,
} from './ConnectDialogs.js';
import { ConnectEnhanceButton } from './ConnectEnhanceButton.js';
import {
  mergePresentationMessages,
  shouldShowPendingReply,
  visibleWorkspaceMessages,
} from './workspace-chat-presentation.js';

/* ── Draft model ──────────────────────────────────────────────────────────── */

/** A composed-but-not-yet-persisted Connect conversation. A direct draft carries
 *  the employee; a group draft carries the full create payload. Neither has a DB
 *  row until the first message, so it never appears in the sidebar list. */
interface DirectDraft {
  kind: 'direct';
  id: string;
  employeeId: string;
  employeeName: string;
}
interface GroupDraft {
  kind: 'group';
  id: string;
  title: string;
  employeeIds: string[];
  replyPolicy: CollaborationReplyPolicy;
}
type ConnectDraft = DirectDraft | GroupDraft;

/** Shared compact age wording (lib/utils) over an ISO stamp; '' when unparsable. */
function timeLabelFrom(iso: string): string {
  return compactAge(Date.parse(iso));
}

/* ── List row ─────────────────────────────────────────────────────────────── */

function ThreadAvatar({
  thread,
  employee,
}: { thread: CollaborationThreadSummary; employee: Employee | null }) {
  if (thread.kind === 'group') {
    return (
      <span className="off-ws-im-av is-group">
        <Icon icon={Users} size="sm" />
      </span>
    );
  }
  if (employee) {
    return (
      <span className="off-ws-im-av-wrap">
        <EmployeeAvatar
          seed={employee.id}
          appearance={employee.appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={40}
          brand={employee.kind === 'external'}
          className="off-ws-im-av-emp"
        />
      </span>
    );
  }
  return (
    <span className="off-ws-im-av is-group">
      <Icon icon={MessageSquare} size="sm" />
    </span>
  );
}

function ThreadRow({
  thread,
  title,
  employee,
  active,
  onSelect,
}: {
  thread: CollaborationThreadSummary;
  title: string;
  employee: Employee | null;
  active: boolean;
  onSelect: () => void;
}) {
  const snippet = thread.lastMessage?.body?.trim() || 'No messages yet';
  return (
    <button
      type="button"
      className={cn('off-ws-im-row off-focusable', active && 'is-active')}
      onClick={onSelect}
    >
      <ThreadAvatar thread={thread} employee={employee} />
      <span className="off-ws-im-main">
        <span className="off-ws-im-l1">
          <span className="off-ws-im-name">{title}</span>
          {thread.kind === 'group' ? <span className="off-ws-im-tag">group</span> : null}
          <span className="off-ws-im-time">{timeLabelFrom(thread.lastActivityAt)}</span>
        </span>
        <span className="off-ws-im-l2">
          <span className="off-ws-im-snip">{snippet}</span>
          {thread.unreadCount > 0 ? (
            <span className="off-ws-im-nb">{thread.unreadCount}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/* ── Transcript message row ───────────────────────────────────────────────── */

interface TranscriptRow extends ConnectViewMessage {
  /** A live speaker turn id, when this row is the in-flight stream for a turn. */
  turnId?: string;
  /** True when this row is the synthetic single-pending placeholder. */
  pending?: boolean;
  /** Live error to surface a Retry control. */
  error?: string;
}

function MessageRow({
  row,
  employee,
  onRetry,
  onStop,
}: {
  row: TranscriptRow;
  employee: Employee | null;
  onRetry?: () => void;
  onStop?: () => void;
}) {
  const isMe = row.author === 'boss';
  const name = isMe ? 'You' : (employee?.name ?? row.senderLabel ?? 'Teammate');
  // Persisted rows carry an ISO createdAt; live streaming rows carry '' (no
  // stamp until the row persists), so the label simply hides for them.
  const timeLabel = timeLabelFrom(row.createdAt);
  if (row.pending) {
    return (
      <div className="off-ws-msg-row">
        <span className="off-ws-msg-from">
          {employee ? (
            <EmployeeAvatar
              seed={employee.id}
              appearance={employee.appearance}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={22}
              brand={employee.kind === 'external'}
            />
          ) : null}
          <span className="off-ws-msg-nm">{name}</span>
        </span>
        <div className="off-ws-bubble is-thinking">
          <span className="off-ws-thinking-dots" aria-label="Typing">
            <i />
            <i />
            <i />
          </span>
          {onStop ? (
            <button type="button" className="off-connect-turn-stop off-focusable" onClick={onStop}>
              <Icon icon={Square} size="sm" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('off-ws-msg-row', isMe && 'is-me')}>
      {!isMe ? (
        <span className="off-ws-msg-from">
          {employee ? (
            <EmployeeAvatar
              seed={employee.id}
              appearance={employee.appearance}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={22}
              brand={employee.kind === 'external'}
            />
          ) : null}
          <span className="off-ws-msg-nm">{name}</span>
          {row.status === 'failed' ? <span className="off-ws-msg-rl">failed</span> : null}
          {row.status === 'interrupted' ? <span className="off-ws-msg-rl">stopped</span> : null}
        </span>
      ) : null}
      {row.body.trim() ? (
        <div className={cn('off-ws-bubble', isMe && 'is-me')}>{row.body}</div>
      ) : row.status === 'failed' ? (
        <div className="off-ws-bubble off-connect-bubble-err">
          {row.error || 'This reply failed.'}
        </div>
      ) : null}
      {timeLabel ? (
        <span className="off-ws-bubble-time" title={new Date(row.createdAt).toLocaleString()}>
          {timeLabel}
        </span>
      ) : null}
      {row.status === 'failed' && onRetry ? (
        <button type="button" className="off-connect-retry off-focusable" onClick={onRetry}>
          <Icon icon={RotateCw} size="sm" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ── Surface ──────────────────────────────────────────────────────────────── */

export function MessengerApp() {
  const companyId = useUiState((s) => s.companyId) || null;
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const pendingDirectChatEmployeeId = useUiState((s) => s.pendingDirectChatEmployeeId);
  const consumePendingDirectChat = useUiState((s) => s.consumePendingDirectChat);

  const employees = useEmployees();
  const threads = useConnectThreads(companyId);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<ConnectDraft | null>(null);

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

  // Reset draft + selection on a company switch (the company key changes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: companyId is an intentionally tracked invalidation key (reset on company switch); selectItem is an unmemoized function ref (not added to avoid render loops).
  useEffect(() => {
    setDraft(null);
    selectItem(null);
    setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Consume the one-shot "Message <employee>" intent from Contacts (flow 1):
  // an existing active direct thread → open it; none → open a fresh direct draft.
  // Wait until threads + employees have loaded so the existing-direct lookup is
  // accurate (a draft created before the list resolves would shadow a real thread).
  // biome-ignore lint/correctness/useExhaustiveDependencies: byId.get, list.find, consumePendingDirectChat, selectItem are function/method refs (not added to avoid render loops); companyId intentionally not re-listed (stable across the intent window).
  useEffect(() => {
    if (!pendingDirectChatEmployeeId) return;
    if (threads.isLoading || employees.isLoading) return;
    const employee = byId.get(pendingDirectChatEmployeeId);
    if (!employee) {
      // The target employee is gone (deleted between the Contacts click and load,
      // or a stale roster). Consume the intent so it doesn't retry forever, but
      // surface an honest failure instead of a silent no-op.
      consumePendingDirectChat();
      toast.error('That employee is no longer available.');
      return;
    }
    // Only consume the intent once we can actually act on it.
    consumePendingDirectChat();
    const existing = list.find(
      (t) => t.kind === 'direct' && t.directEmployeeId === employee.id && !t.archivedAt,
    );
    if (existing) {
      setDraft(null);
      selectItem(existing.threadId);
      return;
    }
    const id = generateId('thread');
    setDraft({ kind: 'direct', id, employeeId: employee.id, employeeName: employee.name });
    selectItem(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDirectChatEmployeeId, threads.isLoading, employees.isLoading]);

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
    setDraft({ kind: 'direct', id, employeeId: employee.id, employeeName: employee.name });
    selectItem(id);
    setDirectPickerOpen(false);
    setNewChatOpen(false);
  }

  function startGroupDraft(input: {
    title: string;
    employeeIds: string[];
    replyPolicy: CollaborationReplyPolicy;
  }): void {
    const id = generateId('thread');
    setDraft({ kind: 'group', id, ...input });
    selectItem(id);
    setNewGroupOpen(false);
    setNewChatOpen(false);
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
            setDraft(null);
            selectItem(threadId);
          } else {
            const threadId = await createGroup.mutateAsync({
              title: activeDraft.title,
              employeeIds: activeDraft.employeeIds,
              replyPolicy: activeDraft.replyPolicy,
            });
            await runtime.send(threadId, body);
            setDraft(null);
            selectItem(threadId);
          }
        }}
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

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head">
          <span className="off-ws-list-title">Chats</span>
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
              {(employees.data ?? []).length === 0
                ? 'Hire an employee to start chatting.'
                : 'No chats yet — start one with New chat.'}
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
              onSelect={() => {
                setDraft(null);
                selectItem(thread.threadId);
              }}
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
                  onSelect={() => {
                    setDraft(null);
                    selectItem(thread.threadId);
                  }}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>

      <div className="off-ws-detail">{detailBody}</div>

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
        onCreate={startGroupDraft}
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

/* ── Persisted thread detail ──────────────────────────────────────────────── */

function PersistedThreadDetail({
  thread,
  title,
  byId,
  runtime,
  onArchiveToggle,
  onProfileToggle,
  onOpenMembers,
  onOpenAskTeam,
}: {
  thread: CollaborationThreadSummary;
  title: string;
  byId: Map<string, Employee>;
  runtime: ReturnType<typeof useConnectRuntime>;
  onArchiveToggle: () => void;
  onProfileToggle: () => void;
  onOpenMembers: () => void;
  onOpenAskTeam: () => void;
}) {
  const messages = useConnectMessages(thread.threadId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const employeesList = useEmployees();
  // The round/ask trigger must be a BOSS-authored message — never the thread's
  // last message of any author (after a round completes that is an employee
  // reply, and continuing on it would make the next speakers reply to a
  // teammate instead of the boss's topic). Seed null; populate only from a
  // persisted boss message below.
  const lastBossRef = useRef<CollaborationMessage | null>(null);

  const persisted = messages.data ?? [];
  const snapshot = runtime.snapshot;

  // Build the transcript: persisted rows overlaid with the live streaming turns
  // (live wins under the same stable message id), then the PR-01 single-pending
  // invariant per active speaker turn.
  //
  // Each live turn projects to a row under its STABLE message id (the same id the
  // controller streams + upserts into the persisted row). The merge keys on id
  // with the live row passed LAST, so a streaming live row overwrites its empty
  // persisted shell; `attemptId` is the turn id so the per-turn pending check
  // keys correctly. `visibleWorkspaceMessages` then drops any empty shell.
  const liveRows: TranscriptRow[] = snapshot.turns.map((t) => ({
    id: t.messageId,
    author: 'employee',
    employeeId: t.employeeId,
    senderLabel: t.speakerName,
    body: t.body,
    status:
      t.phase === 'streaming' || t.phase === 'pending'
        ? 'streaming'
        : (t.phase as ConnectViewMessage['status']),
    at: Number.MAX_SAFE_INTEGER, // live turns sort after persisted in same render
    createdAt: '',
    attemptId: t.turnId,
    turnId: t.turnId,
    error: t.error,
  }));

  const merged = mergePresentationMessages<TranscriptRow>(
    persisted.map((m) => ({ ...m })),
    liveRows,
  );
  const visible = visibleWorkspaceMessages(merged);

  // One synthetic pending slot per ACTIVE speaker turn (never an empty shell).
  // Reuses the PR-01 invariant: a turn that has not yet produced visible payload
  // gets exactly one pending row keyed on its attempt (turnId); the instant body
  // lands, the live row passes the payload filter and the pending row drops.
  const pendingRows: TranscriptRow[] = [];
  for (const turn of snapshot.turns) {
    if (turn.phase !== 'pending' && turn.phase !== 'streaming') continue;
    const show = shouldShowPendingReply({
      run: { phase: 'running', attemptId: turn.turnId },
      visibleMessages: visible,
      activeAttemptId: turn.turnId,
    });
    if (show) {
      pendingRows.push({
        id: `pending-${turn.turnId}`,
        author: 'employee',
        employeeId: turn.employeeId,
        senderLabel: turn.speakerName,
        body: '',
        status: 'pending',
        at: Number.MAX_SAFE_INTEGER,
        createdAt: '',
        turnId: turn.turnId,
        pending: true,
      });
    }
  }

  const rows = [...visible, ...pendingRows];

  // Keep the last BOSS-authored message available as the round/ask trigger. Reset
  // each render and repopulate from the persisted scan so a completed round (whose
  // last message is an employee reply) never leaves a stale employee trigger.
  lastBossRef.current = null;
  for (const m of persisted) {
    if (m.author === 'boss') {
      lastBossRef.current = {
        messageId: m.id,
        threadId: thread.threadId,
        senderType: 'boss',
        body: m.body,
        status: m.status,
        createdAt: m.createdAt,
      };
    }
  }
  const hasBossTrigger = lastBossRef.current != null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: persisted.length and snapshot.turns are intentionally tracked derived values used to trigger scroll-to-bottom on message/turn changes (the callback doesn't reference them directly).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [persisted.length, snapshot.turns]);

  const isGroup = thread.kind === 'group';
  const directEmployee = thread.directEmployeeId
    ? (byId.get(thread.directEmployeeId) ?? null)
    : null;
  const profileLabel = thread.capabilityProfile === 'collaboration_read' ? 'Read-only' : 'Chat';
  const subtitle = isGroup
    ? `${policyLabel(thread.replyPolicy)} · group · ${profileLabel}`
    : `Direct · ${directEmployee?.role ?? '—'} · ${profileLabel}`;

  return (
    <>
      <header className="off-ws-chat-head">
        <ThreadAvatar thread={thread} employee={directEmployee} />
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">{title}</span>
          <span className="off-ws-crumb-sub">{subtitle}</span>
        </div>
        <div className="off-ws-chat-tools">
          {isGroup ? (
            <IconButton
              icon={Settings2}
              label="Group members"
              variant="ghost"
              size="iconSm"
              onClick={onOpenMembers}
            />
          ) : null}
          <IconButton
            icon={BookOpenCheck}
            label={
              thread.capabilityProfile === 'collaboration_read'
                ? 'Switch to full chat — replies can act on the conversation again'
                : 'Switch to read-only — replies can look things up but not act'
            }
            variant={thread.capabilityProfile === 'collaboration_read' ? 'accentSoft' : 'ghost'}
            size="iconSm"
            onClick={onProfileToggle}
          />
          <IconButton
            icon={thread.archivedAt ? ArchiveRestore : Archive}
            label={thread.archivedAt ? 'Unarchive' : 'Archive'}
            variant="ghost"
            size="iconSm"
            onClick={onArchiveToggle}
          />
        </div>
      </header>

      <div className="off-ws-conv-scroll" ref={scrollRef}>
        <section className="off-ws-messages">
          {rows.length === 0 ? (
            <div className="off-connect-thread-empty">
              No messages yet — your first message starts it.
            </div>
          ) : (
            rows.map((row) => (
              <MessageRow
                key={row.id}
                row={row}
                employee={row.employeeId ? (byId.get(row.employeeId) ?? null) : null}
                onStop={
                  row.turnId && (row.status === 'streaming' || row.pending)
                    ? () => runtime.stop(row.turnId as string)
                    : undefined
                }
                onRetry={
                  row.turnId && row.status === 'failed'
                    ? () => {
                        const trigger = lastBossRef.current;
                        if (trigger)
                          void runtime.retry(thread.threadId, row.turnId as string, trigger);
                      }
                    : undefined
                }
              />
            ))
          )}
        </section>
      </div>

      <Composer
        threadId={thread.threadId}
        threadTitle={title}
        scope={isGroup ? 'group' : 'direct'}
        replyPolicy={thread.replyPolicy}
        employees={employeesList.data ?? []}
        participantIds={memberEmployeeIds(thread, byId)}
        running={snapshot.running}
        onStop={() => runtime.stopThread(thread.threadId)}
        onAskTeam={onOpenAskTeam}
        roundInfo={
          isGroup && thread.replyPolicy === 'roundtable'
            ? {
                lastRound: snapshot.lastRound,
                speakerLimit: thread.roundSpeakerLimit,
                hasBossTrigger,
              }
            : null
        }
        onStartRound={async (body) => {
          const sent = await runtime.send(thread.threadId, body);
          await runtime.startRound(thread.threadId, sent.message, {
            mentionedFromBody: body,
            maxSpeakers: thread.roundSpeakerLimit,
          });
        }}
        onContinueRound={async () => {
          const trigger = lastBossRef.current;
          if (trigger)
            await runtime.continueRound(thread.threadId, trigger, {
              maxSpeakers: thread.roundSpeakerLimit,
            });
        }}
        onSend={async (body) => {
          await runtime.send(thread.threadId, body);
        }}
      />
    </>
  );
}

/** The active employee ids on a thread (best effort from the summary; group
 *  member list is the authority but the composer only needs them for @mention). */
function memberEmployeeIds(
  thread: CollaborationThreadSummary,
  _byId: Map<string, Employee>,
): string[] {
  if (thread.kind === 'direct') return thread.directEmployeeId ? [thread.directEmployeeId] : [];
  return [];
}

/* ── Draft thread detail (no DB row yet) ──────────────────────────────────── */

function DraftThreadDetail({
  draft,
  byId,
  onSend,
}: {
  draft: ConnectDraft;
  byId: Map<string, Employee>;
  onSend: (body: string) => Promise<void>;
}) {
  const employeesList = useEmployees();
  const directEmployee = draft.kind === 'direct' ? (byId.get(draft.employeeId) ?? null) : null;
  const title = draft.kind === 'direct' ? draft.employeeName : draft.title;
  const subtitle =
    draft.kind === 'direct'
      ? `Direct · ${directEmployee?.role ?? '—'}`
      : `${policyLabel(draft.replyPolicy)} · ${draft.employeeIds.length} member${
          draft.employeeIds.length === 1 ? '' : 's'
        }`;
  const participantIds = draft.kind === 'direct' ? [draft.employeeId] : draft.employeeIds;

  return (
    <>
      <header className="off-ws-chat-head">
        {draft.kind === 'direct' && directEmployee ? (
          <span className="off-ws-im-av-wrap">
            <EmployeeAvatar
              seed={directEmployee.id}
              appearance={directEmployee.appearance}
              colorA={directEmployee.avatarA}
              colorB={directEmployee.avatarB}
              size={30}
              brand={directEmployee.kind === 'external'}
            />
          </span>
        ) : (
          <span className="off-ws-im-av is-group">
            <Icon icon={draft.kind === 'group' ? Users : MessageSquare} size="sm" />
          </span>
        )}
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">{title}</span>
          <span className="off-ws-crumb-sub">{subtitle}</span>
        </div>
        <div className="off-ws-chat-tools" />
      </header>
      <div className="off-ws-conv-scroll">
        <section className="off-ws-messages">
          <div className="off-connect-thread-empty">
            No messages yet — your first message starts it.
          </div>
        </section>
      </div>
      <Composer
        threadId={null}
        threadTitle={title}
        scope={draft.kind === 'direct' ? 'direct' : 'group'}
        replyPolicy={draft.kind === 'group' ? draft.replyPolicy : 'mentions_only'}
        employees={employeesList.data ?? []}
        participantIds={participantIds}
        running={false}
        onStop={() => undefined}
        onAskTeam={null}
        roundInfo={null}
        onSend={onSend}
        onStartRound={onSend}
        onContinueRound={async () => undefined}
      />
    </>
  );
}

/* ── Composer ─────────────────────────────────────────────────────────────── */

function Composer({
  threadId,
  threadTitle,
  scope,
  replyPolicy,
  employees,
  participantIds,
  running,
  roundInfo,
  onSend,
  onStartRound,
  onContinueRound,
  onStop,
  onAskTeam,
}: {
  threadId: string | null;
  threadTitle: string;
  scope: 'direct' | 'group';
  replyPolicy: CollaborationReplyPolicy;
  employees: readonly Employee[];
  participantIds: string[];
  running: boolean;
  roundInfo: {
    lastRound: { roundId: string; completed: boolean } | null;
    speakerLimit: number;
    /** Whether a boss-authored message exists to continue the round from. */
    hasBossTrigger: boolean;
  } | null;
  onSend: (body: string) => Promise<void>;
  onStartRound: (body: string) => Promise<void>;
  onContinueRound: () => Promise<void>;
  onStop: () => void;
  onAskTeam: (() => void) | null;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const isRoundtable = scope === 'group' && replyPolicy === 'roundtable';

  // Participants the composer can @mention (group members / the direct employee).
  const mentionParticipants = useMemo(
    () =>
      participantIds
        .map((id) => employees.find((e) => e.id === id))
        .filter((e): e is Employee => e != null)
        .map((e) => ({ employeeId: e.id, name: e.name })),
    [participantIds, employees],
  );
  const mentioned = useMemo(
    () => parseMentions(text, mentionParticipants),
    [text, mentionParticipants],
  );

  async function doSend(): Promise<void> {
    if (!trimmed || sending) return;
    const body = text;
    setSending(true);
    setError(null);
    try {
      if (isRoundtable) await onStartRound(body);
      else await onSend(body);
      setText('');
    } catch (err) {
      // Send failure: keep the text + surface a Retry.
      setError(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void doSend();
    }
  }

  const sendDisabled = !trimmed || sending;
  // mentions-only group with no mention: Send just posts (no auto-fire); offer
  // Ask team as the explicit responder action.
  const showAskTeam =
    scope === 'group' && replyPolicy === 'mentions_only' && mentioned.length === 0 && !!onAskTeam;

  return (
    <div className="off-ws-composer off-connect-composer">
      {error ? (
        <div className="off-connect-send-error">
          <span>{error}</span>
          <button
            type="button"
            className="off-connect-retry off-focusable"
            onClick={() => void doSend()}
          >
            <Icon icon={RotateCw} size="sm" />
            Retry
          </button>
        </div>
      ) : null}
      {roundInfo ? (
        <div className="off-connect-round-bar">
          <span className="off-connect-round-info">
            Roundtable · up to {roundInfo.speakerLimit} speaker
            {roundInfo.speakerLimit === 1 ? '' : 's'}
            {roundInfo.lastRound?.completed ? ' · round capped' : ''}
          </span>
          {roundInfo.lastRound?.completed && roundInfo.hasBossTrigger ? (
            <button
              type="button"
              className="off-connect-btn is-primary off-focusable"
              disabled={running}
              onClick={() => void onContinueRound()}
            >
              Continue round
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="off-ws-composer-shell">
        <div className="off-ws-input-wrap">
          <ChatComposerInput
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isRoundtable
                ? 'Message the team, then Start round…'
                : scope === 'group'
                  ? 'Message the team — @mention to ask someone…'
                  : 'Message…'
            }
            aria-label="Message"
          />
          <ConnectEnhanceButton
            threadId={threadId}
            value={text}
            threadTitle={threadTitle}
            scope={scope}
            employees={employees}
            onApply={setText}
          />
        </div>
        {showAskTeam ? (
          <button
            type="button"
            className="off-connect-ask off-focusable"
            onClick={onAskTeam ?? undefined}
            disabled={running}
            title="Ask team"
          >
            <Icon icon={Users} size="sm" />
            Ask team
          </button>
        ) : null}
        {threadId ? <ComposerSettingsMenu threadId={threadId} /> : null}
        {running ? (
          <button
            type="button"
            className="off-ws-send off-connect-stop off-focusable"
            onClick={onStop}
            aria-label="Stop"
            title="Stop"
          >
            <Icon icon={Square} size="sm" />
          </button>
        ) : (
          <button
            type="button"
            className="off-ws-send off-focusable"
            onClick={() => void doSend()}
            disabled={sendDisabled}
            aria-label={isRoundtable ? 'Send and start round' : 'Send'}
            title={isRoundtable ? 'Send and start round' : 'Send'}
          >
            <Icon icon={SendHorizontal} size="sm" />
          </button>
        )}
      </div>
    </div>
  );
}
