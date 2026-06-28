/**
 * CollaborationService — company-scoped daily chat (direct + group) aggregate
 * (PR-02). Company-level only: NO public method accepts a `projectId`, and a
 * Collaboration thread id is never passed to the `chatThreads` repository. This
 * domain is FULLY separate from project-scoped `chat_threads`.
 *
 * Determinism: the service takes no implicit `Date.now()` / `Math.random()`.
 * Timestamps and ids are injected via `now()` / `newId()` so harnesses are
 * reproducible. Mirror this when wiring it into a live path.
 *
 * Additive — no UI, no Pi runtime is attached here (PR-03/PR-05 consume this).
 */

import type {
  AppendCollaborationMessageInput,
  CollaborationMember,
  CollaborationMessage,
  CollaborationMessageCursor,
  CollaborationMessagePage,
  CollaborationReplyPolicy,
  CollaborationThread,
  CreateGroupThreadInput,
} from '@offisim/shared-types';
import {
  buildCollaborationMessageMetadata,
  readSenderLabel,
} from '../repos/collaboration/idempotency.js';
import type { RuntimeRepositories } from '../repositories.js';
import type {
  CollaborationMemberRepository,
  CollaborationMessageRepository,
  CollaborationMessageRow,
  CollaborationReadStateRepository,
  CollaborationThreadMemberRow,
  CollaborationThreadRepository,
  CollaborationThreadRow,
} from '../repositories.js';

const DEFAULT_REPLY_POLICY: CollaborationReplyPolicy = 'mentions_only';
const DEFAULT_ROUND_SPEAKER_LIMIT = 3;
const MIN_ROUND_SPEAKER_LIMIT = 1;
const MAX_ROUND_SPEAKER_LIMIT = 8;
const DEFAULT_PAGE_LIMIT = 50;

/** Sentinel actor id for the human boss member (no employee id). */
export const BOSS_ACTOR_ID = 'boss';

export interface CollaborationServiceDeps {
  newId: () => string;
  now: () => string;
}

/**
 * The repos CollaborationService needs. `asyncTransact` is optional so the
 * service runs against the in-memory backend (which applies writes eagerly);
 * when present, membership updates run inside one transaction.
 */
export interface CollaborationServiceRepos {
  collaborationThreads: CollaborationThreadRepository;
  collaborationMembers: CollaborationMemberRepository;
  collaborationMessages: CollaborationMessageRepository;
  collaborationReadState: CollaborationReadStateRepository;
  asyncTransact?: RuntimeRepositories['asyncTransact'];
}

export interface CollaborationThreadSummary extends CollaborationThread {
  /** Newest message in the thread, or null when empty. */
  lastMessage: CollaborationMessage | null;
  /** Effective ordering timestamp: last message time, else `updatedAt`. */
  lastActivityAt: string;
  /** Messages newer than the read boundary (computed, never stored). */
  unreadCount: number;
}

export interface UpdateMembersInput {
  threadId: string;
  /** Employee ids to add as `member` (idempotent if already active). */
  addEmployeeIds?: readonly string[];
  /** Member ids to mark as left (idempotent if already left). */
  removeMemberIds?: readonly string[];
}

export class CollaborationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CollaborationError';
  }
}

function clampSpeakerLimit(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_ROUND_SPEAKER_LIMIT;
  return Math.min(MAX_ROUND_SPEAKER_LIMIT, Math.max(MIN_ROUND_SPEAKER_LIMIT, Math.trunc(value)));
}

function threadRowToDomain(row: CollaborationThreadRow): CollaborationThread {
  return {
    threadId: row.thread_id,
    companyId: row.company_id,
    kind: row.kind as CollaborationThread['kind'],
    title: row.title,
    directEmployeeId: row.direct_employee_id,
    replyPolicy: row.reply_policy as CollaborationReplyPolicy,
    capabilityProfile:
      row.capability_profile === 'collaboration_read' ? 'collaboration_read' : 'strict',
    roundSpeakerLimit: row.round_speaker_limit,
    createdBy: row.created_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memberRowToDomain(row: CollaborationThreadMemberRow): CollaborationMember {
  return {
    memberId: row.member_id,
    threadId: row.thread_id,
    actorType: row.actor_type as CollaborationMember['actorType'],
    employeeId: row.employee_id,
    role: row.role as CollaborationMember['role'],
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

function messageRowToDomain(row: CollaborationMessageRow): CollaborationMessage {
  return {
    messageId: row.message_id,
    threadId: row.thread_id,
    senderType: row.sender_type as CollaborationMessage['senderType'],
    senderEmployeeId: row.sender_employee_id,
    body: row.body,
    replyToMessageId: row.reply_to_message_id,
    status: row.status as CollaborationMessage['status'],
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

export class CollaborationService {
  constructor(
    private readonly repos: CollaborationServiceRepos,
    private readonly deps: CollaborationServiceDeps,
  ) {}

  /**
   * Return the single ACTIVE direct thread for `(companyId, employeeId)`,
   * creating (or restoring an archived) one if absent. Concurrency-safe and
   * idempotent: the DB partial-unique index `(company_id, direct_employee_id)
   * WHERE kind='direct' AND archived_at IS NULL` means at most one active direct
   * thread can exist; a racing second caller whose insert violates the index
   * falls back to reading the winner's row. An archived direct thread is restored
   * (un-archived) rather than duplicated.
   */
  async getOrCreateDirect(
    companyId: string,
    employeeId: string,
    opts?: { title?: string; replyPolicy?: CollaborationReplyPolicy; roundSpeakerLimit?: number },
  ): Promise<CollaborationThread> {
    const existingActive = await this.repos.collaborationThreads.findActiveDirect(
      companyId,
      employeeId,
    );
    if (existingActive) return threadRowToDomain(existingActive);

    // Restore an archived direct thread instead of creating a duplicate.
    const archived = await this.repos.collaborationThreads.findArchivedDirect(
      companyId,
      employeeId,
    );
    if (archived) {
      const now = this.deps.now();
      await this.repos.collaborationThreads.update(archived.thread_id, {
        archived_at: null,
        updated_at: now,
      });
      // The boss + employee membership rows survive an archive (we never delete
      // members on archive), so no re-seed is needed; ensure they are active.
      await this.ensureDirectMembership(archived.thread_id, employeeId, now);
      const restored = await this.repos.collaborationThreads.findById(archived.thread_id);
      return threadRowToDomain(restored ?? archived);
    }

    const now = this.deps.now();
    const threadId = this.deps.newId();
    const row: CollaborationThreadRow = {
      thread_id: threadId,
      company_id: companyId,
      kind: 'direct',
      title: opts?.title ?? `Direct ${employeeId}`,
      direct_employee_id: employeeId,
      reply_policy: opts?.replyPolicy ?? DEFAULT_REPLY_POLICY,
      capability_profile: 'strict',
      round_speaker_limit: clampSpeakerLimit(opts?.roundSpeakerLimit),
      created_by: BOSS_ACTOR_ID,
      archived_at: null,
      created_at: now,
      updated_at: now,
    };
    try {
      await this.repos.collaborationThreads.insert(row);
    } catch (error) {
      // A concurrent caller won the unique-index race. Re-read the active row and
      // return it; if it is genuinely absent the error was not a uniqueness
      // conflict and must surface.
      const winner = await this.repos.collaborationThreads.findActiveDirect(companyId, employeeId);
      if (winner) return threadRowToDomain(winner);
      throw error;
    }

    // After our own insert, confirm we are the active row. A concurrent winner
    // may have inserted first (when `insert` swallowed the conflict via INSERT OR
    // IGNORE on a backend that doesn't throw); always resolve to the unique
    // active row so both racers converge on a single thread.
    const active = await this.repos.collaborationThreads.findActiveDirect(companyId, employeeId);
    const winning = active ?? row;
    if (winning.thread_id === threadId) {
      await this.ensureDirectMembership(threadId, employeeId, now);
    } else {
      // We lost the race; our row (if INSERT OR IGNORE accepted nothing) does not
      // exist or is a stray. Members for the winner were seeded by the winner.
      await this.ensureDirectMembership(winning.thread_id, employeeId, now);
    }
    return threadRowToDomain(winning);
  }

  private async ensureDirectMembership(
    threadId: string,
    employeeId: string,
    now: string,
  ): Promise<void> {
    const active = await this.repos.collaborationMembers.listActiveByThread(threadId);
    const hasBoss = active.some((m) => m.actor_type === BOSS_ACTOR_ID);
    const hasEmployee = active.some((m) => m.employee_id === employeeId);
    if (!hasBoss) {
      await this.repos.collaborationMembers.insert({
        member_id: this.deps.newId(),
        thread_id: threadId,
        actor_type: 'boss',
        employee_id: null,
        role: 'owner',
        joined_at: now,
        left_at: null,
      });
    }
    if (!hasEmployee) {
      await this.repos.collaborationMembers.insert({
        member_id: this.deps.newId(),
        thread_id: threadId,
        actor_type: 'employee',
        employee_id: employeeId,
        role: 'member',
        joined_at: now,
        left_at: null,
      });
    }
  }

  /** Create a group thread with the boss as owner and ≥1 employee member. */
  async createGroup(input: CreateGroupThreadInput): Promise<CollaborationThread> {
    const employeeIds = [...new Set(input.employeeIds)];
    if (employeeIds.length === 0) {
      throw new CollaborationError('group requires at least one employee', 'group.empty');
    }
    const now = this.deps.now();
    const threadId = this.deps.newId();
    const threadRow: CollaborationThreadRow = {
      thread_id: threadId,
      company_id: input.companyId,
      kind: 'group',
      title: input.title,
      direct_employee_id: null,
      reply_policy: input.replyPolicy ?? DEFAULT_REPLY_POLICY,
      capability_profile: 'strict',
      round_speaker_limit: clampSpeakerLimit(input.roundSpeakerLimit),
      created_by: BOSS_ACTOR_ID,
      archived_at: null,
      created_at: now,
      updated_at: now,
    };
    const memberRows: CollaborationThreadMemberRow[] = [
      {
        member_id: this.deps.newId(),
        thread_id: threadId,
        actor_type: 'boss',
        employee_id: null,
        role: 'owner',
        joined_at: now,
        left_at: null,
      },
      ...employeeIds.map((employeeId) => ({
        member_id: this.deps.newId(),
        thread_id: threadId,
        actor_type: 'employee' as const,
        employee_id: employeeId,
        role: 'member' as const,
        joined_at: now,
        left_at: null,
      })),
    ];
    await this.runAtomic(async (repos) => {
      await repos.collaborationThreads.insert(threadRow);
      for (const member of memberRows) {
        await repos.collaborationMembers.insert(member);
      }
    });
    return threadRowToDomain(threadRow);
  }

  /**
   * Active company threads ordered by real last activity (last message time,
   * else `updatedAt`) — newest first. Each row carries its last message and a
   * computed unread count.
   */
  async listThreads(companyId: string): Promise<CollaborationThreadSummary[]> {
    const rows = await this.repos.collaborationThreads.listByCompany(companyId);
    const summaries = await Promise.all(
      rows.map(async (row) => {
        const latest = await this.repos.collaborationMessages.findLatestByThread(row.thread_id);
        const readState = await this.repos.collaborationReadState.findByThread(row.thread_id);
        const unreadCount = await this.repos.collaborationMessages.countSince(
          row.thread_id,
          readState?.last_read_message_id ?? null,
        );
        return {
          ...threadRowToDomain(row),
          lastMessage: latest ? messageRowToDomain(latest) : null,
          lastActivityAt: latest?.created_at ?? row.updated_at,
          unreadCount,
        } satisfies CollaborationThreadSummary;
      }),
    );
    return summaries.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  /**
   * One page of messages, NEWEST first, keyset-paginated. `cursor` returns rows
   * strictly older than it — no duplicates, no gaps. `nextCursor` is null when
   * the start of history is reached.
   */
  async listMessages(
    threadId: string,
    cursor?: CollaborationMessageCursor | null,
    limit = DEFAULT_PAGE_LIMIT,
  ): Promise<CollaborationMessagePage> {
    const rows = await this.repos.collaborationMessages.listByThread(threadId, {
      limit: limit + 1,
      before: cursor ?? undefined,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      messages: page.map(messageRowToDomain),
      nextCursor:
        hasMore && last ? { createdAt: last.created_at, messageId: last.message_id } : null,
    };
  }

  /**
   * Append a message. With an `idempotencyKey`, a second append carrying the same
   * key on the same thread is a no-op that returns the already-stored message —
   * so a double-click (or a retried first-message materialization) never creates
   * a duplicate. The sender label is snapshotted into `metadataJson` so the
   * message stays attributable after the sender employee is deleted (FK SET NULL).
   */
  async appendMessage(input: AppendCollaborationMessageInput): Promise<CollaborationMessage> {
    if (input.idempotencyKey != null) {
      const existing = await this.repos.collaborationMessages.findByIdempotencyKey(
        input.threadId,
        input.idempotencyKey,
      );
      if (existing) return messageRowToDomain(existing);
    }
    const now = this.deps.now();
    const messageId = this.deps.newId();
    const metadataJson = buildCollaborationMessageMetadata({
      senderLabel: input.senderLabel,
      metadata: input.metadata,
    });
    const row: CollaborationMessageRow = {
      message_id: messageId,
      thread_id: input.threadId,
      sender_type: input.senderType,
      sender_employee_id: input.senderEmployeeId ?? null,
      body: input.body,
      reply_to_message_id: input.replyToMessageId ?? null,
      status: input.status ?? 'complete',
      idempotency_key: input.idempotencyKey ?? null,
      metadata_json: metadataJson,
      created_at: now,
      edited_at: null,
    };
    await this.repos.collaborationMessages.insert(row);
    // Re-read under the idempotency key in case a concurrent append with the same
    // key won; both racers then converge on the single stored row.
    if (input.idempotencyKey != null) {
      const settled = await this.repos.collaborationMessages.findByIdempotencyKey(
        input.threadId,
        input.idempotencyKey,
      );
      if (settled) {
        await this.touchThread(input.threadId, settled.created_at);
        return messageRowToDomain(settled);
      }
    }
    await this.touchThread(input.threadId, now);
    return messageRowToDomain(row);
  }

  private async touchThread(threadId: string, at: string): Promise<void> {
    const thread = await this.repos.collaborationThreads.findById(threadId);
    if (!thread) return;
    // Only advance updated_at; never let an out-of-order append move it backwards.
    if (at > thread.updated_at) {
      await this.repos.collaborationThreads.update(threadId, { updated_at: at });
    }
  }

  /**
   * Add/remove members in a SINGLE transaction. Adds are skipped when the
   * employee is already an active member; removals mark `left_at`. Constraints:
   * a group must retain ≥1 active employee member and the boss owner.
   */
  async updateMembers(input: UpdateMembersInput): Promise<CollaborationMember[]> {
    const thread = await this.repos.collaborationThreads.findById(input.threadId);
    if (!thread) {
      throw new CollaborationError('thread not found', 'thread.not_found');
    }
    if (thread.kind === 'direct') {
      throw new CollaborationError('direct threads have fixed membership', 'members.direct_fixed');
    }
    const now = this.deps.now();

    return this.runAtomic(async (repos) => {
      const active = await repos.collaborationMembers.listActiveByThread(input.threadId);
      const activeEmployeeIds = new Set(
        active.filter((m) => m.actor_type === 'employee').map((m) => m.employee_id),
      );

      // Removals
      const removeIds = new Set(input.removeMemberIds ?? []);
      const survivingEmployees = active.filter(
        (m) => m.actor_type === 'employee' && !removeIds.has(m.member_id),
      );
      const removingBossOwner = active.some(
        (m) => m.actor_type === 'boss' && removeIds.has(m.member_id),
      );
      if (removingBossOwner) {
        throw new CollaborationError('cannot remove the boss owner', 'members.boss_required');
      }
      // Adds (after computing survivors so the count check is post-update).
      const toAdd = [...new Set(input.addEmployeeIds ?? [])].filter(
        (id) => !activeEmployeeIds.has(id),
      );
      if (survivingEmployees.length + toAdd.length < 1) {
        throw new CollaborationError(
          'group must retain at least one employee member',
          'members.min_employee',
        );
      }

      for (const memberId of removeIds) {
        await repos.collaborationMembers.markLeft(memberId, now);
      }
      for (const employeeId of toAdd) {
        await repos.collaborationMembers.insert({
          member_id: this.deps.newId(),
          thread_id: input.threadId,
          actor_type: 'employee',
          employee_id: employeeId,
          role: 'member',
          joined_at: now,
          left_at: null,
        });
      }
      await repos.collaborationThreads.update(input.threadId, { updated_at: now });
      const updated = await repos.collaborationMembers.listActiveByThread(input.threadId);
      return updated.map(memberRowToDomain);
    });
  }

  async updateCapabilityProfile(
    threadId: string,
    capabilityProfile: CollaborationThread['capabilityProfile'],
  ): Promise<void> {
    await this.repos.collaborationThreads.update(threadId, {
      capability_profile: capabilityProfile,
      updated_at: this.deps.now(),
    });
  }

  async archive(threadId: string): Promise<void> {
    const thread = await this.repos.collaborationThreads.findById(threadId);
    if (!thread || thread.archived_at != null) return;
    const now = this.deps.now();
    await this.repos.collaborationThreads.update(threadId, { archived_at: now, updated_at: now });
  }

  async unarchive(threadId: string): Promise<void> {
    const thread = await this.repos.collaborationThreads.findById(threadId);
    if (!thread || thread.archived_at == null) return;
    const now = this.deps.now();
    await this.repos.collaborationThreads.update(threadId, { archived_at: null, updated_at: now });
  }

  /**
   * Move the read boundary to `messageId` (defaults to the thread's latest
   * message). Unread is COMPUTED from this boundary; nothing is ever stored as a
   * drifting counter.
   */
  async markRead(threadId: string, messageId?: string): Promise<void> {
    let boundaryId = messageId ?? null;
    if (boundaryId == null) {
      const latest = await this.repos.collaborationMessages.findLatestByThread(threadId);
      boundaryId = latest?.message_id ?? null;
    }
    await this.repos.collaborationReadState.upsert({
      thread_id: threadId,
      last_read_message_id: boundaryId,
      updated_at: this.deps.now(),
    });
  }

  /** Unread count for a thread, computed from the stored last-read boundary. */
  async unreadCount(threadId: string): Promise<number> {
    const readState = await this.repos.collaborationReadState.findByThread(threadId);
    return this.repos.collaborationMessages.countSince(
      threadId,
      readState?.last_read_message_id ?? null,
    );
  }

  async listMembers(threadId: string): Promise<CollaborationMember[]> {
    const rows = await this.repos.collaborationMembers.listActiveByThread(threadId);
    return rows.map(memberRowToDomain);
  }

  /**
   * Run `fn` inside a transaction when the backend supports it, else eagerly.
   * The in-memory backend has no transactional boundary (writes apply on call),
   * so it runs `fn` directly with the same repos.
   */
  private async runAtomic<T>(fn: (repos: CollaborationServiceRepos) => Promise<T>): Promise<T> {
    if (this.repos.asyncTransact) {
      return this.repos.asyncTransact((txRepos) => {
        const repos = (txRepos ?? this.repos) as unknown as CollaborationServiceRepos;
        return fn(repos);
      });
    }
    return fn(this.repos);
  }
}

export function createCollaborationService(
  repos: CollaborationServiceRepos,
  deps: CollaborationServiceDeps,
): CollaborationService {
  return new CollaborationService(repos, deps);
}

/** Re-exported so callers can read the persisted sender-label snapshot. */
export { readSenderLabel };
