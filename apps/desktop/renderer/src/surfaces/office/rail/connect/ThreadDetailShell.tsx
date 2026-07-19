import type { CompanyThreadDraft } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import type { CollaborationThreadSummary } from '@offisim/core/browser';
import type { CollaborationMessage } from '@offisim/shared-types';
import {
  Archive,
  ArchiveRestore,
  BookOpenCheck,
  ChevronLeft,
  MessageSquare,
  Settings2,
  Users,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useRef } from 'react';
import { policyLabel } from './ConnectDialogs.js';
import { type ConnectViewMessage, useConnectMessages } from './collaboration-data.js';
import {
  mergePresentationMessages,
  shouldShowPendingReply,
  visibleWorkspaceMessages,
} from './company-chat-presentation.js';
import type { useConnectRuntime } from './use-connect-runtime.js';

import { Composer } from './Composer.js';
import { MessageRow, type TranscriptRow } from './MessageRow.js';
import { ThreadAvatar } from './ThreadRow.js';

/** A composed-but-not-yet-persisted Connect conversation. A direct draft carries
 *  the employee; a group draft carries the full create payload. Neither has a DB
 *  row until the first message, so it never appears in the sidebar list. */
type ConnectDraft = CompanyThreadDraft;

function ThreadDetailShell({
  onBack,
  avatar,
  title,
  subtitle,
  tools,
  scrollRef,
  children,
  composer,
}: {
  onBack: () => void;
  avatar: ReactNode;
  title: string;
  subtitle: string;
  tools: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  composer: ReactNode;
}) {
  return (
    <>
      <header className="off-ws-chat-head">
        <IconButton
          icon={ChevronLeft}
          label="Back to conversations"
          variant="ghost"
          size="icon"
          onClick={onBack}
        />
        {avatar}
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">{title}</span>
          <span className="off-ws-crumb-sub">{subtitle}</span>
        </div>
        <div className="off-ws-chat-tools">{tools}</div>
      </header>
      <div className="off-ws-conv-scroll" ref={scrollRef}>
        <section className="off-ws-messages">{children}</section>
      </div>
      {composer}
    </>
  );
}

/* ── Persisted thread detail ──────────────────────────────────────────────── */

export function PersistedThreadDetail({
  thread,
  title,
  byId,
  runtime,
  onArchiveToggle,
  onProfileToggle,
  onOpenMembers,
  onOpenAskTeam,
  onBack,
}: {
  thread: CollaborationThreadSummary;
  title: string;
  byId: Map<string, Employee>;
  runtime: ReturnType<typeof useConnectRuntime>;
  onArchiveToggle: () => void;
  onProfileToggle: () => void;
  onOpenMembers: () => void;
  onOpenAskTeam: () => void;
  onBack: () => void;
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
    <ThreadDetailShell
      onBack={onBack}
      avatar={<ThreadAvatar thread={thread} employee={directEmployee} />}
      title={title}
      subtitle={subtitle}
      tools={
        <>
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
        </>
      }
      scrollRef={scrollRef}
      composer={
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
      }
    >
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
                    if (trigger) void runtime.retry(thread.threadId, row.turnId as string, trigger);
                  }
                : undefined
            }
          />
        ))
      )}
    </ThreadDetailShell>
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

export function DraftThreadDetail({
  draft,
  byId,
  onSend,
  onBack,
}: {
  draft: ConnectDraft;
  byId: Map<string, Employee>;
  onSend: (body: string) => Promise<void>;
  onBack: () => void;
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
    <ThreadDetailShell
      onBack={onBack}
      avatar={
        draft.kind === 'direct' && directEmployee ? (
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
        )
      }
      title={title}
      subtitle={subtitle}
      tools={null}
      composer={
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
      }
    >
      <div className="off-connect-thread-empty">
        No messages yet — your first message starts it.
      </div>
    </ThreadDetailShell>
  );
}
