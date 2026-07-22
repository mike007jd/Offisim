import type {
  CompactSummaryRepository,
  CompactSummaryRow,
  MemoryDedupeLookup,
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryReinforcementPatch,
  MemoryRepository,
  MemoryUpdatePatch,
  NewCompactSummary,
  NewNodeSummary,
  NodeSummaryRepository,
  NodeSummaryRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows, now } from '../memory-utils.js';
import { buildMemoryUpdatePatch, normalizeMemoryDedupeKey } from './patch.js';

/**
 * In-memory implementation of MemoryRepository.
 * Used for tests and browser-only runtime.
 */
export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly store = new Map<string, MemoryEntryRow>();

  constructor(initialRows?: Iterable<MemoryEntryRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.memory_id, { ...row });
    }
  }

  async create(entry: MemoryEntryCreate): Promise<MemoryEntryRow> {
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
    this.store.set(row.memory_id, row);
    return row;
  }

  async findById(memoryId: string): Promise<MemoryEntryRow | null> {
    return this.store.get(memoryId) ?? null;
  }

  async findByDedupeKey(lookup: MemoryDedupeLookup): Promise<MemoryEntryRow | null> {
    for (const row of this.store.values()) {
      if (
        row.company_id === lookup.companyId &&
        row.scope === lookup.scope &&
        row.owner_id === lookup.ownerId &&
        row.category === lookup.category &&
        row.dedupe_key === lookup.dedupeKey
      ) {
        return row;
      }
    }
    return null;
  }

  async search(
    query: string,
    opts: { scope?: string; ownerId?: string; companyId: string; limit?: number },
  ): Promise<MemoryEntryRow[]> {
    // Extract significant words (3+ chars) for word-based matching
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const results = [...this.store.values()].filter((row) => {
      if (row.company_id !== opts.companyId) return false;
      if (opts.scope && row.scope !== opts.scope) return false;
      if (opts.ownerId && row.owner_id !== opts.ownerId) return false;
      // Word-based matching: any significant query word in content matches
      const lowerContent = row.content.toLowerCase();
      return queryWords.some((word) => lowerContent.includes(word));
    });
    results.sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.last_reinforced_at.localeCompare(a.last_reinforced_at);
    });
    const limit = opts.limit ?? 10;
    return results.slice(0, limit);
  }

  async delete(memoryId: string): Promise<void> {
    this.store.delete(memoryId);
  }

  async findByOwner(
    ownerId: string,
    opts?: { category?: string; companyId?: string; scope?: string; limit?: number | null },
  ): Promise<MemoryEntryRow[]> {
    let results = [...this.store.values()].filter((row) => row.owner_id === ownerId);
    if (opts?.companyId) {
      results = results.filter((row) => row.company_id === opts.companyId);
    }
    if (opts?.scope) {
      results = results.filter((row) => row.scope === opts.scope);
    }
    if (opts?.category) {
      results = results.filter((row) => row.category === opts.category);
    }
    results.sort((a, b) => b.importance - a.importance);
    if (opts?.limit === null) return results;
    return results.slice(0, opts?.limit ?? 50);
  }

  async reinforce(
    memoryId: string,
    patch: MemoryReinforcementPatch,
  ): Promise<MemoryEntryRow | null> {
    const row = this.store.get(memoryId);
    if (!row) return null;

    const updated: MemoryEntryRow = {
      ...row,
      content:
        patch.content && patch.content.length > row.content.length ? patch.content : row.content,
      importance: patch.importance ? Math.max(row.importance, patch.importance) : row.importance,
      confidence: patch.confidence ? Math.max(row.confidence, patch.confidence) : row.confidence,
      metadata_json: patch.metadataJson ?? row.metadata_json,
      source_thread_id: patch.sourceThreadId ?? row.source_thread_id,
      reinforcement_count: row.reinforcement_count + 1,
      last_reinforced_at: now(),
    };
    this.store.set(memoryId, updated);
    return updated;
  }

  async update(memoryId: string, patch: MemoryUpdatePatch): Promise<MemoryEntryRow | null> {
    const row = this.store.get(memoryId);
    if (!row) return null;
    const updates = buildMemoryUpdatePatch(patch);
    if (Object.keys(updates).length === 0) return row;
    const updated: MemoryEntryRow = { ...row, ...updates };
    this.store.set(memoryId, updated);
    return updated;
  }

  async touchAccess(memoryId: string): Promise<void> {
    const row = this.store.get(memoryId);
    if (row) {
      this.store.set(memoryId, {
        ...row,
        accessed_at: now(),
        access_count: row.access_count + 1,
      });
    }
  }

  snapshot(): MemoryEntryRow[] {
    return [...this.store.values()].map((row) => ({ ...row }));
  }
}

export class MemoryNodeSummaryRepository implements NodeSummaryRepository {
  private readonly rows: NodeSummaryRow[] = [];

  constructor(initialRows?: Iterable<NodeSummaryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(summary: NewNodeSummary): Promise<NodeSummaryRow> {
    this.rows.push(summary);
    return summary;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<NodeSummaryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async countByThread(threadId: string): Promise<number> {
    return this.rows.filter((row) => row.thread_id === threadId).length;
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  async trimByThread(threadId: string, keepLatest: number): Promise<void> {
    if (keepLatest < 0) return;
    const keepIds = new Set(
      (await this.listByThread(threadId, { limit: keepLatest })).map((row) => row.summary_id),
    );
    for (let index = this.rows.length - 1; index >= 0; index--) {
      const row = this.rows[index];
      if (row?.thread_id === threadId && !keepIds.has(row.summary_id)) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): NodeSummaryRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryCompactSummaryRepository implements CompactSummaryRepository {
  private readonly rows: CompactSummaryRow[] = [];

  constructor(initialRows?: Iterable<CompactSummaryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(summary: NewCompactSummary): Promise<CompactSummaryRow> {
    this.rows.push(summary);
    return summary;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<CompactSummaryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): CompactSummaryRow[] {
    return cloneRows(this.rows);
  }
}

export interface MemorySystemMemoryRepos {
  memories: InMemoryMemoryRepository;
  nodeSummaries: MemoryNodeSummaryRepository;
  compactSummaries: MemoryCompactSummaryRepository;
}

export function createMemorySystemMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): MemorySystemMemoryRepos {
  const memories = new InMemoryMemoryRepository(snapshot?.memories);
  const nodeSummaries = new MemoryNodeSummaryRepository(snapshot?.nodeSummaries);
  const compactSummaries = new MemoryCompactSummaryRepository(snapshot?.compactSummaries);
  return { memories, nodeSummaries, compactSummaries };
}
