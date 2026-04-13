import { DEFAULT_COST_RATES } from '@offisim/core/browser';

type CostRateRepo = {
  findAll: () => Promise<unknown[]>;
  upsert: (rate: {
    provider: string;
    model_pattern: string;
    input_cost_per_mtok: number;
    output_cost_per_mtok: number;
    effective_from: string;
    effective_until: null;
  }) => Promise<unknown>;
};

export async function seedDefaultCostRatesIfEmpty(
  repos: { costRates: CostRateRepo },
  effectiveFrom = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const existing = await repos.costRates.findAll();
  if (existing.length > 0) return;

  for (const rate of DEFAULT_COST_RATES) {
    await repos.costRates.upsert({
      provider: rate.provider,
      model_pattern: rate.model_pattern,
      input_cost_per_mtok: rate.input_cost_per_mtok,
      output_cost_per_mtok: rate.output_cost_per_mtok,
      effective_from: effectiveFrom,
      effective_until: null,
    });
  }
}
