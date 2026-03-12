import type {
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryRepository,
} from '../runtime/repositories.js';

function now(): string {
  return new Date().toISOString();
}

/**
 * In-memory implementation of MemoryRepository.
 * Used for tests and browser-only runtime.
 */
export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly store = new Map<string, MemoryEntryRow>();

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
    // Sort by importance DESC
    results.sort((a, b) => b.importance - a.importance);
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
}
