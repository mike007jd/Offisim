import type {
  MemoryDedupeLookup,
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryReinforcementPatch,
  MemoryRepository,
} from '../runtime/repositories.js';

function now(): string {
  return new Date().toISOString();
}

function normalizeMemoryDedupeKey(content: string): string {
  const normalized = content.normalize('NFKC').toLowerCase();
  const simplified = normalized
    .replace(/[.,:;/，。：；、]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return simplified || normalized.replace(/\s+/g, ' ').trim();
}

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
      source_task_run_id: entry.source_task_run_id ?? null,
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
    opts?: { category?: string; limit?: number },
  ): Promise<MemoryEntryRow[]> {
    let results = [...this.store.values()].filter((row) => row.owner_id === ownerId);
    if (opts?.category) {
      results = results.filter((row) => row.category === opts.category);
    }
    results.sort((a, b) => b.importance - a.importance);
    const limit = opts?.limit ?? 50;
    return results.slice(0, limit);
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
      source_task_run_id: patch.sourceTaskRunId ?? row.source_task_run_id,
      reinforcement_count: row.reinforcement_count + 1,
      last_reinforced_at: now(),
    };
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
