import type {
  CollaborationMemberRepository,
  CollaborationMessagePatch,
  CollaborationMessageRepository,
  CollaborationMessageRow,
  CollaborationReadStateRepository,
  CollaborationReadStateRow,
  CollaborationThreadMemberRow,
  CollaborationThreadPatch,
  CollaborationThreadRepository,
  CollaborationThreadRow,
  CollaborationTurnPatch,
  CollaborationTurnRepository,
  CollaborationTurnRow,
  NewCollaborationMessage,
  NewCollaborationThread,
  NewCollaborationThreadMember,
  NewCollaborationTurn,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

const DEFAULT_PAGE_LIMIT = 50;

export interface CollaborationTauriRepos {
  collaborationThreads: CollaborationThreadRepository;
  collaborationMembers: CollaborationMemberRepository;
  collaborationMessages: CollaborationMessageRepository;
  collaborationReadState: CollaborationReadStateRepository;
  collaborationTurns: CollaborationTurnRepository;
}

export function createCollaborationTauriRepos(db: TauriDrizzleDb): CollaborationTauriRepos {
  const collaborationThreads: CollaborationThreadRepository = {
    async insert(row: NewCollaborationThread) {
      await db
        .insert(schema.collaborationThreads)
        .values(row)
        .onConflictDoNothing({ target: schema.collaborationThreads.thread_id });
    },
    async findById(threadId) {
      const rows = (await db
        .select()
        .from(schema.collaborationThreads)
        .where(eq(schema.collaborationThreads.thread_id, threadId))) as CollaborationThreadRow[];
      return rows[0] ?? null;
    },
    async findActiveDirect(companyId, employeeId) {
      const rows = (await db
        .select()
        .from(schema.collaborationThreads)
        .where(
          and(
            eq(schema.collaborationThreads.company_id, companyId),
            eq(schema.collaborationThreads.kind, 'direct'),
            eq(schema.collaborationThreads.direct_employee_id, employeeId),
            isNull(schema.collaborationThreads.archived_at),
          ),
        )) as CollaborationThreadRow[];
      return rows[0] ?? null;
    },
    async findArchivedDirect(companyId, employeeId) {
      const rows = (await db
        .select()
        .from(schema.collaborationThreads)
        .where(
          and(
            eq(schema.collaborationThreads.company_id, companyId),
            eq(schema.collaborationThreads.kind, 'direct'),
            eq(schema.collaborationThreads.direct_employee_id, employeeId),
            sql`${schema.collaborationThreads.archived_at} IS NOT NULL`,
          ),
        )
        .orderBy(desc(schema.collaborationThreads.archived_at))) as CollaborationThreadRow[];
      return rows[0] ?? null;
    },
    async listByCompany(companyId) {
      return (await db
        .select()
        .from(schema.collaborationThreads)
        .where(
          and(
            eq(schema.collaborationThreads.company_id, companyId),
            isNull(schema.collaborationThreads.archived_at),
          ),
        )
        .orderBy(desc(schema.collaborationThreads.updated_at))) as CollaborationThreadRow[];
    },
    async update(threadId, patch: CollaborationThreadPatch) {
      const set: Partial<CollaborationThreadRow> = { updated_at: patch.updated_at };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.reply_policy !== undefined) set.reply_policy = patch.reply_policy;
      if (patch.round_speaker_limit !== undefined)
        set.round_speaker_limit = patch.round_speaker_limit;
      if (patch.archived_at !== undefined) set.archived_at = patch.archived_at;
      await db
        .update(schema.collaborationThreads)
        .set(set)
        .where(eq(schema.collaborationThreads.thread_id, threadId));
    },
  };

  const collaborationMembers: CollaborationMemberRepository = {
    async insert(row: NewCollaborationThreadMember) {
      await db
        .insert(schema.collaborationThreadMembers)
        .values(row)
        .onConflictDoNothing({ target: schema.collaborationThreadMembers.member_id });
    },
    async listActiveByThread(threadId) {
      return (await db
        .select()
        .from(schema.collaborationThreadMembers)
        .where(
          and(
            eq(schema.collaborationThreadMembers.thread_id, threadId),
            isNull(schema.collaborationThreadMembers.left_at),
          ),
        )
        .orderBy(asc(schema.collaborationThreadMembers.joined_at))) as CollaborationThreadMemberRow[];
    },
    async listAllByThread(threadId) {
      return (await db
        .select()
        .from(schema.collaborationThreadMembers)
        .where(eq(schema.collaborationThreadMembers.thread_id, threadId))
        .orderBy(asc(schema.collaborationThreadMembers.joined_at))) as CollaborationThreadMemberRow[];
    },
    async markLeft(memberId, leftAt) {
      await db
        .update(schema.collaborationThreadMembers)
        .set({ left_at: leftAt })
        .where(
          and(
            eq(schema.collaborationThreadMembers.member_id, memberId),
            isNull(schema.collaborationThreadMembers.left_at),
          ),
        );
    },
  };

  const collaborationMessages: CollaborationMessageRepository = {
    async insert(row: NewCollaborationMessage) {
      // Target-less: ignore a conflict on EITHER the message_id PK OR the partial
      // unique (thread_id, idempotency_key) index, so a concurrent double-send is
      // a no-op and the service catch-rereads the single winner.
      await db.insert(schema.collaborationMessages).values(row).onConflictDoNothing();
    },
    async findById(messageId) {
      const rows = (await db
        .select()
        .from(schema.collaborationMessages)
        .where(eq(schema.collaborationMessages.message_id, messageId))) as CollaborationMessageRow[];
      return rows[0] ?? null;
    },
    async findByIdempotencyKey(threadId, idempotencyKey) {
      const rows = (await db
        .select()
        .from(schema.collaborationMessages)
        .where(
          and(
            eq(schema.collaborationMessages.thread_id, threadId),
            eq(schema.collaborationMessages.idempotency_key, idempotencyKey),
          ),
        )
        .orderBy(asc(schema.collaborationMessages.created_at))) as CollaborationMessageRow[];
      return rows[0] ?? null;
    },
    async listByThread(threadId, opts) {
      const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
      const before = opts?.before;
      const cursorClause = before
        ? or(
            lt(schema.collaborationMessages.created_at, before.createdAt),
            and(
              eq(schema.collaborationMessages.created_at, before.createdAt),
              lt(schema.collaborationMessages.message_id, before.messageId),
            ),
          )
        : undefined;
      return (await db
        .select()
        .from(schema.collaborationMessages)
        .where(and(eq(schema.collaborationMessages.thread_id, threadId), cursorClause))
        .orderBy(
          desc(schema.collaborationMessages.created_at),
          desc(schema.collaborationMessages.message_id),
        )
        .limit(limit)) as CollaborationMessageRow[];
    },
    async findLatestByThread(threadId) {
      const rows = (await db
        .select()
        .from(schema.collaborationMessages)
        .where(eq(schema.collaborationMessages.thread_id, threadId))
        .orderBy(
          desc(schema.collaborationMessages.created_at),
          desc(schema.collaborationMessages.message_id),
        )
        .limit(1)) as CollaborationMessageRow[];
      return rows[0] ?? null;
    },
    async countSince(threadId, messageId) {
      const boundaryRows = messageId
        ? ((await db
            .select()
            .from(schema.collaborationMessages)
            .where(eq(schema.collaborationMessages.message_id, messageId))) as CollaborationMessageRow[])
        : [];
      const boundary = boundaryRows[0] ?? null;
      const newerClause = boundary
        ? or(
            sql`${schema.collaborationMessages.created_at} > ${boundary.created_at}`,
            and(
              eq(schema.collaborationMessages.created_at, boundary.created_at),
              sql`${schema.collaborationMessages.message_id} > ${boundary.message_id}`,
            ),
          )
        : undefined;
      const rows = (await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.collaborationMessages)
        .where(
          and(eq(schema.collaborationMessages.thread_id, threadId), newerClause),
        )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    async update(messageId, patch: CollaborationMessagePatch) {
      const set: Partial<CollaborationMessageRow> = {};
      if (patch.body !== undefined) set.body = patch.body;
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.edited_at !== undefined) set.edited_at = patch.edited_at;
      if (Object.keys(set).length === 0) return;
      await db
        .update(schema.collaborationMessages)
        .set(set)
        .where(eq(schema.collaborationMessages.message_id, messageId));
    },
  };

  const collaborationReadState: CollaborationReadStateRepository = {
    async findByThread(threadId) {
      const rows = (await db
        .select()
        .from(schema.collaborationReadState)
        .where(eq(schema.collaborationReadState.thread_id, threadId))) as CollaborationReadStateRow[];
      return rows[0] ?? null;
    },
    async upsert(row: CollaborationReadStateRow) {
      await db
        .insert(schema.collaborationReadState)
        .values(row)
        .onConflictDoUpdate({
          target: schema.collaborationReadState.thread_id,
          set: {
            last_read_message_id: row.last_read_message_id,
            updated_at: row.updated_at,
          },
        });
    },
  };

  const collaborationTurns: CollaborationTurnRepository = {
    async insert(row: NewCollaborationTurn) {
      await db
        .insert(schema.collaborationTurns)
        .values(row)
        .onConflictDoNothing({ target: schema.collaborationTurns.turn_id });
    },
    async findById(turnId) {
      const rows = (await db
        .select()
        .from(schema.collaborationTurns)
        .where(eq(schema.collaborationTurns.turn_id, turnId))) as CollaborationTurnRow[];
      return rows[0] ?? null;
    },
    async listByThread(threadId) {
      return (await db
        .select()
        .from(schema.collaborationTurns)
        .where(eq(schema.collaborationTurns.thread_id, threadId))
        .orderBy(asc(schema.collaborationTurns.sequence_index))) as CollaborationTurnRow[];
    },
    async update(turnId, patch: CollaborationTurnPatch) {
      const set: Partial<CollaborationTurnRow> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.runtime_request_id !== undefined) set.runtime_request_id = patch.runtime_request_id;
      if (patch.usage_json !== undefined) set.usage_json = patch.usage_json;
      if (patch.error_summary !== undefined) set.error_summary = patch.error_summary;
      if (patch.started_at !== undefined) set.started_at = patch.started_at;
      if (patch.finished_at !== undefined) set.finished_at = patch.finished_at;
      if (Object.keys(set).length === 0) return;
      await db
        .update(schema.collaborationTurns)
        .set(set)
        .where(eq(schema.collaborationTurns.turn_id, turnId));
    },
  };

  return {
    collaborationThreads,
    collaborationMembers,
    collaborationMessages,
    collaborationReadState,
    collaborationTurns,
  };
}
