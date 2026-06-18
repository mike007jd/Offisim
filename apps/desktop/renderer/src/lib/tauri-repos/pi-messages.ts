import type { PiMessageRepository, PiMessageRow } from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

export interface PiMessagesTauriRepos {
  piMessages: PiMessageRepository;
}

export function createPiMessagesTauriRepos(db: TauriDrizzleDb): PiMessagesTauriRepos {
  const piMessages: PiMessageRepository = {
    async listByThread(threadId: string): Promise<PiMessageRow[]> {
      return (await db
        .select()
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))
        .orderBy(asc(schema.piMessages.seq))) as PiMessageRow[];
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
    async lastEmployeeId(threadId: string): Promise<string | null> {
      const rows = (await db
        .select({ employee_id: schema.piMessages.employee_id })
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))
        .orderBy(desc(schema.piMessages.seq))
        .limit(1)) as Array<{ employee_id: string | null }>;
      return rows[0]?.employee_id ?? null;
    },
    async deleteFirstByThread(threadId: string, count: number): Promise<void> {
      if (count <= 0) return;
      const prefix = (await db
        .select({ seq: schema.piMessages.seq })
        .from(schema.piMessages)
        .where(eq(schema.piMessages.thread_id, threadId))
        .orderBy(asc(schema.piMessages.seq))
        .limit(count)) as Array<{ seq: number }>;
      const cutoffSeq = prefix.at(-1)?.seq;
      if (cutoffSeq === undefined) return;
      await db
        .delete(schema.piMessages)
        .where(
          and(eq(schema.piMessages.thread_id, threadId), lte(schema.piMessages.seq, cutoffSeq)),
        );
    },
    async deleteByThread(threadId: string): Promise<void> {
      await db.delete(schema.piMessages).where(eq(schema.piMessages.thread_id, threadId));
    },
  };
  return { piMessages };
}
