import * as schema from '@offisim/db-local/dist/schema.js';
import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  ActiveInteractionRepository,
  InteractionActiveRow,
  InteractionHistoryRepository,
  InteractionHistoryRow,
  MeetingRepository,
  MeetingSessionRow,
  NewInteractionActive,
  NewInteractionHistory,
  NewMeetingSession,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface ConversationsDrizzleRepos {
  meetings: MeetingRepository;
  activeInteractions: ActiveInteractionRepository;
  interactionHistory: InteractionHistoryRepository;
}

export function createConversationsDrizzleRepos(db: Db): ConversationsDrizzleRepos {
  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      db.insert(schema.meetingSessions).values(m).run();
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id))
        .all();
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      const rows = db
        .select()
        .from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.company_id, companyId))
        .orderBy(desc(schema.meetingSessions.created_at))
        .all();
      return rows as MeetingSessionRow[];
    },
    async updateStatus(id, status, summaryJson) {
      db.update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id))
        .run();
    },
  };

  const activeInteractions: ActiveInteractionRepository = {
    async upsert(row: NewInteractionActive) {
      db.insert(schema.activeThreadInteractions)
        .values(row)
        .onConflictDoUpdate({
          target: schema.activeThreadInteractions.thread_id,
          set: {
            company_id: row.company_id,
            interaction_id: row.interaction_id,
            kind: row.kind,
            interaction_mode: row.interaction_mode,
            request_json: row.request_json,
            payload_json: row.payload_json,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        })
        .run();
      return row as InteractionActiveRow;
    },
    async findByThread(threadId) {
      const rows = db
        .select()
        .from(schema.activeThreadInteractions)
        .where(eq(schema.activeThreadInteractions.thread_id, threadId))
        .all();
      return (rows[0] as InteractionActiveRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      const rows = db
        .select()
        .from(schema.activeThreadInteractions)
        .where(eq(schema.activeThreadInteractions.company_id, companyId))
        .orderBy(desc(schema.activeThreadInteractions.updated_at))
        .all();
      return rows as InteractionActiveRow[];
    },
    async deleteByThread(threadId) {
      db.delete(schema.activeThreadInteractions)
        .where(eq(schema.activeThreadInteractions.thread_id, threadId))
        .run();
    },
  };

  const interactionHistory: InteractionHistoryRepository = {
    async create(row: NewInteractionHistory) {
      db.insert(schema.interactionHistory).values(row).run();
      return row as InteractionHistoryRow;
    },
    async listByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.interactionHistory)
        .where(eq(schema.interactionHistory.thread_id, threadId))
        .orderBy(desc(schema.interactionHistory.resolved_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as InteractionHistoryRow[];
    },
    async listByCompany(companyId, opts) {
      let query = db
        .select()
        .from(schema.interactionHistory)
        .where(eq(schema.interactionHistory.company_id, companyId))
        .orderBy(desc(schema.interactionHistory.resolved_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as InteractionHistoryRow[];
    },
  };

  return { meetings, activeInteractions, interactionHistory };
}
