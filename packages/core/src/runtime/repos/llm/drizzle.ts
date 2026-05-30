import * as schema from '@offisim/db-local/dist/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  LlmCallRepository,
  LlmCallRow,
  ModelCostRateRepository,
  ModelCostRateRow,
  NewLlmCall,
  NewModelCostRate,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface LlmDrizzleRepos {
  llmCalls: LlmCallRepository;
  costRates: ModelCostRateRepository;
}

export function createLlmDrizzleRepos(db: Db): LlmDrizzleRepos {
  const llmCalls: LlmCallRepository = {
    async create(c: NewLlmCall) {
      db.insert(schema.llmCalls).values(c).run();
      return c as LlmCallRow;
    },
    async findByThread(threadId) {
      return db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.thread_id, threadId))
        .all() as LlmCallRow[];
    },
    async findByThreadIds(threadIds) {
      if (threadIds.length === 0) return [];
      return db
        .select()
        .from(schema.llmCalls)
        .where(inArray(schema.llmCalls.thread_id, threadIds))
        .all() as LlmCallRow[];
    },
    async findByTaskRun(taskRunId) {
      return db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.task_run_id, taskRunId))
        .all() as LlmCallRow[];
    },
  };

  // Compiled-regex cache keyed by provider. Every cost lookup previously
  // rebuilt N RegExp objects from `model_pattern` strings; on a hot streaming
  // path with N=20+ patterns per provider this showed up. The cache is
  // invalidated by `upsert` below — the only path that mutates the rates set.
  const costRateRegexCache = new Map<string, { rows: ModelCostRateRow[]; compiled: RegExp[] }>();
  function rebuildCostRateCache(provider: string): {
    rows: ModelCostRateRow[];
    compiled: RegExp[];
  } {
    const rows = db
      .select()
      .from(schema.modelCostRates)
      .where(eq(schema.modelCostRates.provider, provider))
      .all() as ModelCostRateRow[];
    const compiled = rows.map((r) => {
      // Escape regex metacharacters first, then translate glob wildcards (*
      // → .*, ? → .). Without this, an unescaped '.' / '+' / '(' / '[' in
      // model_pattern would be regex-meta and overmatch (e.g.
      // 'gpt-4.5o-mini' would match 'gpt-4Xo-mini' and mis-bill).
      const escaped = r.model_pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${escaped}$`, 'i');
    });
    const entry = { rows, compiled };
    costRateRegexCache.set(provider, entry);
    return entry;
  }
  const costRates: ModelCostRateRepository = {
    async create(rate: NewModelCostRate) {
      const row: ModelCostRateRow = {
        ...rate,
        rate_id: `mcr-${crypto.randomUUID()}`,
        created_at: now(),
      };
      db.insert(schema.modelCostRates).values(row).run();
      costRateRegexCache.delete(rate.provider);
      return row;
    },
    async findByProviderModel(provider, model) {
      const entry = costRateRegexCache.get(provider) ?? rebuildCostRateCache(provider);
      const matching: ModelCostRateRow[] = [];
      for (let i = 0; i < entry.rows.length; i++) {
        if (entry.compiled[i]?.test(model)) {
          const row = entry.rows[i];
          if (row) matching.push(row);
        }
      }
      if (matching.length === 0) return null;
      matching.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
      const [bestMatch] = matching;
      return bestMatch ?? null;
    },
    async findAll() {
      return db.select().from(schema.modelCostRates).all() as ModelCostRateRow[];
    },
    async upsert(rate: NewModelCostRate) {
      const ts = now();
      const rateId = `mcr-${crypto.randomUUID()}`;
      const values: ModelCostRateRow = {
        rate_id: rateId,
        ...rate,
        created_at: ts,
      };
      db.insert(schema.modelCostRates)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.modelCostRates.provider,
            schema.modelCostRates.model_pattern,
            schema.modelCostRates.effective_from,
          ],
          set: {
            input_cost_per_mtok: rate.input_cost_per_mtok,
            output_cost_per_mtok: rate.output_cost_per_mtok,
            effective_until: rate.effective_until,
          },
        })
        .run();
      costRateRegexCache.delete(rate.provider);
      const persisted = db
        .select()
        .from(schema.modelCostRates)
        .where(
          and(
            eq(schema.modelCostRates.provider, rate.provider),
            eq(schema.modelCostRates.model_pattern, rate.model_pattern),
            eq(schema.modelCostRates.effective_from, rate.effective_from),
          ),
        )
        .all() as ModelCostRateRow[];
      const out = persisted[0] as ModelCostRateRow | undefined;
      if (!out) throw new Error('cost rate upsert failed to persist');
      return out;
    },
  };

  return { llmCalls, costRates };
}
