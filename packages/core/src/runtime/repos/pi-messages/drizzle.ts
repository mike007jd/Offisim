import * as schema from '@offisim/db-local/dist/schema.js';
import { asc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PiMessageRepository, PiMessageRow } from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

export function createPiMessagesDrizzleRepo(db: Db): PiMessageRepository {
  return {
    async listByThread(threadId: string): Promise<PiMessageRow[]> {
      return db
        .select()
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))
        .orderBy(asc(schema.piMessages.seq))
        .all() as PiMessageRow[];
    },
    async append(rows: readonly PiMessageRow[]): Promise<void> {
      if (rows.length === 0) return;
      db.insert(schema.piMessages)
        .values(rows as PiMessageRow[])
        .run();
    },
    async maxSeq(threadId: string): Promise<number> {
      const row = db
        .select({ m: sql<number | null>`max(${schema.piMessages.seq})` })
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))
        .get();
      return row?.m ?? -1;
    },
    async deleteByThread(threadId: string): Promise<void> {
      db.delete(schema.piMessages).where(eq(schema.piMessages.thread_id, threadId)).run();
    },
  };
}
