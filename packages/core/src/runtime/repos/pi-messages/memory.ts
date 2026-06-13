import type { PiMessageRepository, PiMessageRow } from '../../repositories.js';

export function createPiMessagesMemoryRepo(): PiMessageRepository {
  const byThread = new Map<string, PiMessageRow[]>();
  return {
    async listByThread(threadId: string): Promise<PiMessageRow[]> {
      return [...(byThread.get(threadId) ?? [])].sort((a, b) => a.seq - b.seq);
    },
    async append(rows: readonly PiMessageRow[]): Promise<void> {
      for (const row of rows) {
        const list = byThread.get(row.thread_id) ?? [];
        list.push(row);
        byThread.set(row.thread_id, list);
      }
    },
    async maxSeq(threadId: string): Promise<number> {
      const list = byThread.get(threadId);
      if (!list || list.length === 0) return -1;
      return list.reduce((m, r) => (r.seq > m ? r.seq : m), -1);
    },
    async deleteByThread(threadId: string): Promise<void> {
      byThread.delete(threadId);
    },
  };
}
