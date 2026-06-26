import * as schema from '@offisim/db-local/dist/schema.js';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  CollaborationMemberRepository,
  CollaborationMessageRepository,
  CollaborationMessageRow,
  CollaborationReadStateRepository,
  CollaborationReadStateRow,
  CollaborationThreadMemberRow,
  CollaborationThreadPatch,
  CollaborationThreadRepository,
  CollaborationThreadRow,
  NewCollaborationMessage,
  NewCollaborationThread,
  NewCollaborationThreadMember,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_PAGE_LIMIT = 50;

export interface CollaborationDrizzleRepos {
  collaborationThreads: CollaborationThreadRepository;
  collaborationMembers: CollaborationMemberRepository;
  collaborationMessages: CollaborationMessageRepository;
  collaborationReadState: CollaborationReadStateRepository;
}

export function createCollaborationDrizzleRepos(db: Db): CollaborationDrizzleRepos {
  const collaborationThreads: CollaborationThreadRepository = {
    async insert(row: NewCollaborationThread) {
      db.insert(schema.collaborationThreads)
        .values(row)
        .onConflictDoNothing({ target: schema.collaborationThreads.thread_id })
        .run();
    },
    async findById(threadId) {
      const rows = db
        .select()
        .from(schema.collaborationThreads)
        .where(eq(schema.collaborationThreads.thread_id, threadId))
        .all() as CollaborationThreadRow[];
      return rows[0] ?? null;
    },
    async findActiveDirect(companyId, employeeId) {
      const rows = db
        .select()
        .from(schema.collaborationThreads)
        .where(
          and(
            eq(schema.collaborationThreads.company_id, companyId),
            eq(schema.collaborationThreads.kind, 'direct'),
            eq(schema.collaborationThreads.direct_employee_id, employeeId),
            isNull(schema.collaborationThreads.archived_at),
          ),
        )
        .all() as CollaborationThreadRow[];
      return rows[0] ?? null;
    },
    async findArchivedDirect(companyId, employeeId) {
      const rows = db
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
        .orderBy(desc(schema.collaborationThreads.archived_at))
        .all() as CollaborationThreadRow[];
      return rows[0] ?? null;
    },
    async listByCompany(companyId) {
      return db
        .select()
        .from(schema.collaborationThreads)
        .where(
          and(
            eq(schema.collaborationThreads.company_id, companyId),
            isNull(schema.collaborationThreads.archived_at),
          ),
        )
        .orderBy(desc(schema.collaborationThreads.updated_at))
        .all() as CollaborationThreadRow[];
    },
    async update(threadId, patch: CollaborationThreadPatch) {
      const set: Partial<CollaborationThreadRow> = { updated_at: patch.updated_at };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.reply_policy !== undefined) set.reply_policy = patch.reply_policy;
      if (patch.round_speaker_limit !== undefined)
        set.round_speaker_limit = patch.round_speaker_limit;
      if (patch.archived_at !== undefined) set.archived_at = patch.archived_at;
      db.update(schema.collaborationThreads)
        .set(set)
        .where(eq(schema.collaborationThreads.thread_id, threadId))
        .run();
    },
  };

  const collaborationMembers: CollaborationMemberRepository = {
    async insert(row: NewCollaborationThreadMember) {
      db.insert(schema.collaborationThreadMembers)
        .values(row)
        .onConflictDoNothing({ target: schema.collaborationThreadMembers.member_id })
        .run();
    },
    async listActiveByThread(threadId) {
      return db
        .select()
        .from(schema.collaborationThreadMembers)
        .where(
          and(
            eq(schema.collaborationThreadMembers.thread_id, threadId),
            isNull(schema.collaborationThreadMembers.left_at),
          ),
        )
        .orderBy(asc(schema.collaborationThreadMembers.joined_at))
        .all() as CollaborationThreadMemberRow[];
    },
    async listAllByThread(threadId) {
      return db
        .select()
        .from(schema.collaborationThreadMembers)
        .where(eq(schema.collaborationThreadMembers.thread_id, threadId))
        .orderBy(asc(schema.collaborationThreadMembers.joined_at))
        .all() as CollaborationThreadMemberRow[];
    },
    async markLeft(memberId, leftAt) {
      db.update(schema.collaborationThreadMembers)
        .set({ left_at: leftAt })
        .where(
          and(
            eq(schema.collaborationThreadMembers.member_id, memberId),
            isNull(schema.collaborationThreadMembers.left_at),
          ),
        )
        .run();
    },
  };

  const collaborationMessages: CollaborationMessageRepository = {
    async insert(row: NewCollaborationMessage) {
      // Target-less: ignore a conflict on EITHER the message_id PK OR the partial
      // unique (thread_id, idempotency_key) index, so a concurrent double-send is
      // a no-op and the service catch-rereads the single winner.
      db.insert(schema.collaborationMessages).values(row).onConflictDoNothing().run();
    },
    async findById(messageId) {
      const rows = db
        .select()
        .from(schema.collaborationMessages)
        .where(eq(schema.collaborationMessages.message_id, messageId))
        .all() as CollaborationMessageRow[];
      return rows[0] ?? null;
    },
    async findByIdempotencyKey(threadId, idempotencyKey) {
      const rows = db
        .select()
        .from(schema.collaborationMessages)
        .where(
          and(
            eq(schema.collaborationMessages.thread_id, threadId),
            eq(schema.collaborationMessages.idempotency_key, idempotencyKey),
          ),
        )
        .orderBy(asc(schema.collaborationMessages.created_at))
        .all() as CollaborationMessageRow[];
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
      return db
        .select()
        .from(schema.collaborationMessages)
        .where(and(eq(schema.collaborationMessages.thread_id, threadId), cursorClause))
        .orderBy(
          desc(schema.collaborationMessages.created_at),
          desc(schema.collaborationMessages.message_id),
        )
        .limit(limit)
        .all() as CollaborationMessageRow[];
    },
    async findLatestByThread(threadId) {
      const rows = db
        .select()
        .from(schema.collaborationMessages)
        .where(eq(schema.collaborationMessages.thread_id, threadId))
        .orderBy(
          desc(schema.collaborationMessages.created_at),
          desc(schema.collaborationMessages.message_id),
        )
        .limit(1)
        .all() as CollaborationMessageRow[];
      return rows[0] ?? null;
    },
    async countSince(threadId, messageId) {
      // Unread = messages strictly newer than the last-read boundary. When the
      // boundary message is missing/null, every message in the thread is unread.
      const boundary = messageId
        ? ((
            db
              .select()
              .from(schema.collaborationMessages)
              .where(eq(schema.collaborationMessages.message_id, messageId))
              .all() as CollaborationMessageRow[]
          )[0] ?? null)
        : null;
      const newerClause = boundary
        ? or(
            sql`${schema.collaborationMessages.created_at} > ${boundary.created_at}`,
            and(
              eq(schema.collaborationMessages.created_at, boundary.created_at),
              sql`${schema.collaborationMessages.message_id} > ${boundary.message_id}`,
            ),
          )
        : undefined;
      const rows = db
        .select({ n: sql<number>`count(*)` })
        .from(schema.collaborationMessages)
        .where(and(eq(schema.collaborationMessages.thread_id, threadId), newerClause))
        .all() as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
  };

  const collaborationReadState: CollaborationReadStateRepository = {
    async findByThread(threadId) {
      const rows = db
        .select()
        .from(schema.collaborationReadState)
        .where(eq(schema.collaborationReadState.thread_id, threadId))
        .all() as CollaborationReadStateRow[];
      return rows[0] ?? null;
    },
    async upsert(row: CollaborationReadStateRow) {
      db.insert(schema.collaborationReadState)
        .values(row)
        .onConflictDoUpdate({
          target: schema.collaborationReadState.thread_id,
          set: {
            last_read_message_id: row.last_read_message_id,
            updated_at: row.updated_at,
          },
        })
        .run();
    },
  };

  return {
    collaborationThreads,
    collaborationMembers,
    collaborationMessages,
    collaborationReadState,
  };
}
