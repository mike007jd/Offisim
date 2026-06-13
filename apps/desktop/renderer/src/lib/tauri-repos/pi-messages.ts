import type { PiMessageRepository, PiMessageRow } from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { asc, eq, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

export interface PiMessagesTauriRepos {
  piMessages: PiMessageRepository;
}

export function createPiMessagesTauriRepos(db: TauriDrizzleDb): PiMessagesTauriRepos {
  const piMessages: PiMessageRepository = {
    async listByThread(threadId: string): Promise<PiMessageRow[]> {
      const rows = (await db
        .select()
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))
        .orderBy(asc(schema.piMessages.seq))) as PiMessageRow[];
      return rows;
    },
    async append(rows: readonly PiMessageRow[]): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(schema.piMessages).values(rows as PiMessageRow[]);
    },
    async maxSeq(threadId: string): Promise<number> {
      const rows = (await db
        .select({ m: sql<number | null>`max(${schema.piMessages.seq})` })
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))) as Array<{ m: number | null }>;
      return rows[0]?.m ?? -1;
    },
    async deleteByThread(threadId: string): Promise<void> {
      await db.delete(schema.piMessages).where(eq(schema.piMessages.thread_id, threadId));
    },
  };
  return { piMessages };
}
