import { globToRegex } from '@offisim/core/browser';
import type {
  ModelCostRateRepository,
  ModelCostRateRow,
  NewModelCostRate,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, eq } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface LlmTauriRepos {
  costRates: ModelCostRateRepository;
}

export function createLlmTauriRepos(db: TauriDrizzleDb): LlmTauriRepos {
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
      // Shared escape-then-translate rule (avoids drift across the renderer/core
      // glob copies). See @offisim/core's glob-match.
      const matching = rows.filter((r) => globToRegex(r.model_pattern).test(model));
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

  return { costRates };
}
