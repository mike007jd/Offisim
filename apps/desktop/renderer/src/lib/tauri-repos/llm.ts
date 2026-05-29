import type {
  LlmCallRepository,
  LlmCallRow,
  ModelCostRateRepository,
  ModelCostRateRow,
  NewLlmCall,
  NewModelCostRate,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, eq, inArray } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface LlmTauriRepos {
  llmCalls: LlmCallRepository;
  costRates: ModelCostRateRepository;
}

export function createLlmTauriRepos(db: TauriDrizzleDb): LlmTauriRepos {
  const llmCalls: LlmCallRepository = {
    async create(c: NewLlmCall) {
      await db.insert(schema.llmCalls).values(c);
      return c as LlmCallRow;
    },
    async findByThread(threadId) {
      return (await db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.thread_id, threadId))) as LlmCallRow[];
    },
    async findByThreadIds(threadIds) {
      if (threadIds.length === 0) return [];
      return (await db
        .select()
        .from(schema.llmCalls)
        .where(inArray(schema.llmCalls.thread_id, threadIds))) as LlmCallRow[];
    },
    async findByTaskRun(taskRunId) {
      return (await db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.task_run_id, taskRunId))) as LlmCallRow[];
    },
  };

  const costRates: ModelCostRateRepository = {
    async create(rate: NewModelCostRate) {
      const row: ModelCostRateRow = {
        ...rate,
        rate_id: crypto.randomUUID(),
        created_at: now(),
      };
      await db.insert(schema.modelCostRates).values(row);
      return row;
    },
    async findByProviderModel(provider, model) {
      const rows = (await db
        .select()
        .from(schema.modelCostRates)
        .where(eq(schema.modelCostRates.provider, provider))) as ModelCostRateRow[];
      const matching = rows.filter((r) => {
        // Escape regex metacharacters BEFORE translating glob wildcards so a
        // pattern like `gpt-4.1` matches the literal dot, not any char.
        const escaped = r.model_pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`, 'i').test(model);
      });
      if (matching.length === 0) return null;
      matching.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
      return matching[0] ?? null;
    },
    async findAll() {
      return (await db.select().from(schema.modelCostRates)) as ModelCostRateRow[];
    },
    async upsert(rate: NewModelCostRate) {
      const values: ModelCostRateRow = {
        rate_id: crypto.randomUUID(),
        ...rate,
        created_at: now(),
      };
      await db
        .insert(schema.modelCostRates)
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
        });
      const persisted = (await db
        .select()
        .from(schema.modelCostRates)
        .where(
          and(
            eq(schema.modelCostRates.provider, rate.provider),
            eq(schema.modelCostRates.model_pattern, rate.model_pattern),
            eq(schema.modelCostRates.effective_from, rate.effective_from),
          ),
        )) as ModelCostRateRow[];
      const [row] = persisted;
      if (!row) {
        throw new Error('Expected upserted model cost rate row to be present.');
      }
      return row;
    },
  };

  return { llmCalls, costRates };
}
