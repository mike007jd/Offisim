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
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { desc, eq } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface ConversationsTauriRepos {
  meetings: MeetingRepository;
  activeInteractions: ActiveInteractionRepository;
  interactionHistory: InteractionHistoryRepository;
}

export function createConversationsTauriRepos(db: TauriDrizzleDb): ConversationsTauriRepos {
  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      await db.insert(schema.meetingSessions).values(m);
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id));
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      const rows = await db
        .select()
        .from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.company_id, companyId))
        .orderBy(desc(schema.meetingSessions.created_at));
      return rows as MeetingSessionRow[];
    },
    async updateStatus(id, status, summaryJson) {
      await db
        .update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id));
    },
  };

  const activeInteractions: ActiveInteractionRepository = {
    async upsert(row: NewInteractionActive) {
      await db
        .insert(schema.activeThreadInteractions)
        .values(row)
        .onConflictDoUpdate({
          target: schema.activeThreadInteractions.thread_id,
          set: {
            company_id: row.company_id,
            interaction_id: row.interaction_id,
            kind: row.kind,
            interaction_mode: row.interaction_mode,
            request_json: row.request_json,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        });
      return row as InteractionActiveRow;
    },
    async findByThread(threadId) {
      const rows = await db
        .select()
        .from(schema.activeThreadInteractions)
        .where(eq(schema.activeThreadInteractions.thread_id, threadId));
      return (rows[0] as InteractionActiveRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      const rows = await db
        .select()
        .from(schema.activeThreadInteractions)
        .where(eq(schema.activeThreadInteractions.company_id, companyId))
        .orderBy(desc(schema.activeThreadInteractions.updated_at));
      return rows as InteractionActiveRow[];
    },
    async deleteByThread(threadId) {
      await db
        .delete(schema.activeThreadInteractions)
        .where(eq(schema.activeThreadInteractions.thread_id, threadId));
    },
  };

  const interactionHistory: InteractionHistoryRepository = {
    async create(row: NewInteractionHistory) {
      await db.insert(schema.interactionHistory).values(row);
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
      return (await query) as InteractionHistoryRow[];
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
      return (await query) as InteractionHistoryRow[];
    },
  };

  return { meetings, activeInteractions, interactionHistory };
}
