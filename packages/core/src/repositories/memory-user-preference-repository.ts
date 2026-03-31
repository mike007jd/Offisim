import type {
  UserPreferenceCategory,
  UserPreferenceCreate,
  UserPreferenceRepository,
  UserPreferenceRow,
} from '../runtime/repositories.js';

/**
 * In-memory UserPreferenceRepository for testing.
 */
export class MemoryUserPreferenceRepository implements UserPreferenceRepository {
  private store = new Map<string, UserPreferenceRow>();

  constructor(initialRows?: Iterable<UserPreferenceRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.preference_id, { ...row });
    }
  }

  async create(entry: UserPreferenceCreate): Promise<UserPreferenceRow> {
    const now = new Date().toISOString();
    const row: UserPreferenceRow = {
      preference_id: entry.preference_id,
      company_id: entry.company_id,
      category: entry.category,
      content: entry.content,
      confidence: entry.confidence ?? 0.7,
      importance: entry.importance ?? 0.5,
      source: entry.source,
      dedupe_key: entry.dedupe_key ?? null,
      reinforcement_count: 0,
      access_count: 0,
      source_thread_id: entry.source_thread_id ?? null,
      created_at: now,
      accessed_at: now,
    };
    this.store.set(row.preference_id, row);
    return row;
  }

  async findByCompany(
    companyId: string,
    opts?: { category?: UserPreferenceCategory; limit?: number },
  ): Promise<UserPreferenceRow[]> {
    let results = [...this.store.values()].filter((r) => r.company_id === companyId);
    if (opts?.category) {
      results = results.filter((r) => r.category === opts.category);
    }
    // Sort by importance * confidence descending
    results.sort((a, b) => b.importance * b.confidence - a.importance * a.confidence);
    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }
    return results;
  }

  async findByDedupeKey(companyId: string, dedupeKey: string): Promise<UserPreferenceRow | null> {
    for (const row of this.store.values()) {
      if (row.company_id === companyId && row.dedupe_key === dedupeKey) {
        return row;
      }
    }
    return null;
  }

  async reinforce(preferenceId: string): Promise<void> {
    const row = this.store.get(preferenceId);
    if (row) {
      this.store.set(preferenceId, {
        ...row,
        reinforcement_count: row.reinforcement_count + 1,
        accessed_at: new Date().toISOString(),
      });
    }
  }

  async touchAccess(preferenceId: string): Promise<void> {
    const row = this.store.get(preferenceId);
    if (row) {
      this.store.set(preferenceId, {
        ...row,
        access_count: row.access_count + 1,
        accessed_at: new Date().toISOString(),
      });
    }
  }

  async delete(preferenceId: string): Promise<void> {
    this.store.delete(preferenceId);
  }

  snapshot(): UserPreferenceRow[] {
    return [...this.store.values()].map((row) => ({ ...row }));
  }
}
