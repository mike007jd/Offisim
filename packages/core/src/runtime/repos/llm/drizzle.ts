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

  const costRates: ModelCostRateRepository = {
    async create(rate: NewModelCostRate) {
      const row: ModelCostRateRow = {
        ...rate,
        rate_id: crypto.randomUUID(),
        created_at: now(),
      };
      db.insert(schema.modelCostRates).values(row).run();
      return row;
    },
    async findByProviderModel(provider, model) {
      const rows = db
        .select()
        .from(schema.modelCostRates)
        .where(eq(schema.modelCostRates.provider, provider))
        .all() as ModelCostRateRow[];
      const matching = rows.filter((r) => {
        const regex = new RegExp(
          `^${r.model_pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
          'i',
        );
        return regex.test(model);
      });
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
      return persisted[0] as ModelCostRateRow;
    },
  };

  return { llmCalls, costRates };
}
