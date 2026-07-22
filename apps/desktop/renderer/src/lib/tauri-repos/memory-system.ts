import {
  type CompactSummaryRepository,
  type CompactSummaryRow,
  type MemoryEntryCreate,
  type MemoryEntryRow,
  type MemoryRepository,
  type NewCompactSummary,
  type NewNodeSummary,
  type NodeSummaryRepository,
  type NodeSummaryRow,
  buildMemoryUpdatePatch,
  normalizeMemoryDedupeKey,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

type MemoryDedupeLookup = Parameters<MemoryRepository['findByDedupeKey']>[0];
type MemoryReinforcementPatch = Parameters<MemoryRepository['reinforce']>[1];

export interface MemorySystemTauriRepos {
  memories: MemoryRepository;
  nodeSummaries: NodeSummaryRepository;
  compactSummaries: CompactSummaryRepository;
}

export function createMemorySystemTauriRepos(db: TauriDrizzleDb): MemorySystemTauriRepos {
  const memories: MemoryRepository = {
    async create(entry: MemoryEntryCreate) {
      const ts = now();
      const row: MemoryEntryRow = {
        memory_id: entry.memory_id,
        company_id: entry.company_id,
        scope: entry.scope,
        owner_id: entry.owner_id,
        category: entry.category,
        content: entry.content,
        importance: entry.importance,
        confidence: entry.confidence ?? 0.7,
        dedupe_key: entry.dedupe_key ?? normalizeMemoryDedupeKey(entry.content),
        reinforcement_count: entry.reinforcement_count ?? 1,
        last_reinforced_at: entry.last_reinforced_at ?? ts,
        metadata_json: entry.metadata_json ?? null,
        source_thread_id: entry.source_thread_id ?? null,
        created_at: ts,
        accessed_at: ts,
        access_count: 0,
      };
      await db.insert(schema.memoryEntries).values(row);
      return row;
    },
    async findById(memoryId) {
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(eq(schema.memoryEntries.memory_id, memoryId));
      return (rows[0] as MemoryEntryRow | undefined) ?? null;
    },
    async findByDedupeKey(lookup: MemoryDedupeLookup) {
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(
          and(
            eq(schema.memoryEntries.company_id, lookup.companyId),
            eq(schema.memoryEntries.scope, lookup.scope),
            eq(schema.memoryEntries.owner_id, lookup.ownerId),
            eq(schema.memoryEntries.category, lookup.category),
            eq(schema.memoryEntries.dedupe_key, lookup.dedupeKey),
          ),
        );
      return (rows[0] as MemoryEntryRow | undefined) ?? null;
    },
    async search(query, opts) {
      const conditions = [eq(schema.memoryEntries.company_id, opts.companyId)];
      if (opts.scope) conditions.push(eq(schema.memoryEntries.scope, opts.scope));
      if (opts.ownerId) conditions.push(eq(schema.memoryEntries.owner_id, opts.ownerId));
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (queryWords.length > 0) {
        conditions.push(sql`lower(${schema.memoryEntries.content}) LIKE ${`%${queryWords[0]}%`}`);
      }
      const limit = opts.limit ?? 10;
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(
          desc(schema.memoryEntries.importance),
          desc(schema.memoryEntries.confidence),
          desc(schema.memoryEntries.last_reinforced_at),
        )
        .limit(limit * 5);
      const filtered = (rows as MemoryEntryRow[]).filter((r) => {
        const lower = r.content.toLowerCase();
        return queryWords.some((w) => lower.includes(w));
      });
      return filtered.slice(0, limit);
    },
    async delete(memoryId) {
      await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.memory_id, memoryId));
    },
    async findByOwner(ownerId, opts) {
      const conditions = [eq(schema.memoryEntries.owner_id, ownerId)];
      if (opts?.category) conditions.push(eq(schema.memoryEntries.category, opts.category));
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(
          desc(schema.memoryEntries.importance),
          desc(schema.memoryEntries.confidence),
          desc(schema.memoryEntries.last_reinforced_at),
        )
        .limit(opts?.limit ?? 50);
      return rows as MemoryEntryRow[];
    },
    async reinforce(memoryId, patch: MemoryReinforcementPatch) {
      const existing = await memories.findById(memoryId);
      if (!existing) return null;

      const nextContent =
        patch.content && patch.content.length > existing.content.length
          ? patch.content
          : existing.content;

      await db
        .update(schema.memoryEntries)
        .set({
          content: nextContent,
          importance:
            patch.importance !== undefined
              ? Math.max(existing.importance, patch.importance)
              : existing.importance,
          confidence:
            patch.confidence !== undefined
              ? Math.max(existing.confidence, patch.confidence)
              : existing.confidence,
          metadata_json: patch.metadataJson ?? existing.metadata_json,
          source_thread_id: patch.sourceThreadId ?? existing.source_thread_id,
          reinforcement_count: existing.reinforcement_count + 1,
          last_reinforced_at: now(),
        })
        .where(eq(schema.memoryEntries.memory_id, memoryId));

      return memories.findById(memoryId);
    },
    async update(memoryId, patch) {
      const existing = await memories.findById(memoryId);
      if (!existing) return null;
      const updates = buildMemoryUpdatePatch(patch);
      if (Object.keys(updates).length === 0) return existing;
      await db
        .update(schema.memoryEntries)
        .set(updates)
        .where(eq(schema.memoryEntries.memory_id, memoryId));
      return memories.findById(memoryId);
    },
    async touchAccess(memoryId) {
      await db
        .update(schema.memoryEntries)
        .set({
          accessed_at: now(),
          access_count: sql`${schema.memoryEntries.access_count} + 1`,
        })
        .where(eq(schema.memoryEntries.memory_id, memoryId));
    },
  };

  const nodeSummaries: NodeSummaryRepository = {
    async create(summary: NewNodeSummary) {
      await db.insert(schema.nodeSummaries).values(summary);
      return summary as NodeSummaryRow;
    },
    async listByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.nodeSummaries)
        .where(eq(schema.nodeSummaries.thread_id, threadId))
        .orderBy(desc(schema.nodeSummaries.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as NodeSummaryRow[];
    },
    async countByThread(threadId) {
      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.nodeSummaries)
        .where(eq(schema.nodeSummaries.thread_id, threadId));
      return Number(rows[0]?.count ?? 0);
    },
    async deleteByThread(threadId: string) {
      await db.delete(schema.nodeSummaries).where(eq(schema.nodeSummaries.thread_id, threadId));
    },
    async trimByThread(threadId, keepLatest) {
      if (keepLatest < 0) return;
      const keepRows = await db
        .select({ summary_id: schema.nodeSummaries.summary_id })
        .from(schema.nodeSummaries)
        .where(eq(schema.nodeSummaries.thread_id, threadId))
        .orderBy(desc(schema.nodeSummaries.created_at))
        .limit(keepLatest);
      const keepIds = keepRows.map((row) => row.summary_id);
      if (keepIds.length === 0) {
        await db.delete(schema.nodeSummaries).where(eq(schema.nodeSummaries.thread_id, threadId));
        return;
      }
      await db
        .delete(schema.nodeSummaries)
        .where(
          and(
            eq(schema.nodeSummaries.thread_id, threadId),
            notInArray(schema.nodeSummaries.summary_id, keepIds),
          ),
        );
    },
  };

  const compactSummaries: CompactSummaryRepository = {
    async create(summary: NewCompactSummary) {
      await db.insert(schema.compactSummaries).values(summary);
      return summary as CompactSummaryRow;
    },
    async listByThread(threadId: string, opts?: { limit?: number }) {
      let query = db
        .select()
        .from(schema.compactSummaries)
        .where(eq(schema.compactSummaries.thread_id, threadId))
        .orderBy(desc(schema.compactSummaries.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as CompactSummaryRow[];
    },
    async deleteByThread(threadId) {
      await db
        .delete(schema.compactSummaries)
        .where(eq(schema.compactSummaries.thread_id, threadId));
    },
  };

  return { memories, nodeSummaries, compactSummaries };
}
