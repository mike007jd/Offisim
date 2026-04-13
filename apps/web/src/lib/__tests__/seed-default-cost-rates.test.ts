import { DEFAULT_COST_RATES } from '@offisim/core/browser';
import { describe, expect, it, vi } from 'vitest';
import { seedDefaultCostRatesIfEmpty } from '../seed-default-cost-rates';

describe('seedDefaultCostRatesIfEmpty', () => {
  it('uses costRates.upsert for every default rate when the table is empty', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repos = {
      costRates: {
        findAll: vi.fn().mockResolvedValue([]),
        upsert,
      },
    } as const;

    await seedDefaultCostRatesIfEmpty(repos, '2026-04-14');

    expect(upsert).toHaveBeenCalledTimes(DEFAULT_COST_RATES.length);
    expect(upsert).toHaveBeenCalledWith({
      provider: DEFAULT_COST_RATES[0]?.provider,
      model_pattern: DEFAULT_COST_RATES[0]?.model_pattern,
      input_cost_per_mtok: DEFAULT_COST_RATES[0]?.input_cost_per_mtok,
      output_cost_per_mtok: DEFAULT_COST_RATES[0]?.output_cost_per_mtok,
      effective_from: '2026-04-14',
      effective_until: null,
    });
  });

  it('skips seeding when any cost rates already exist', async () => {
    const repos = {
      costRates: {
        findAll: vi.fn().mockResolvedValue([
          {
            rate_id: 'existing-rate',
            provider: 'openai',
            model_pattern: 'gpt-4o',
            input_cost_per_mtok: 2.5,
            output_cost_per_mtok: 10,
            effective_from: '2026-04-14',
            effective_until: null,
            created_at: '2026-04-14T00:00:00.000Z',
          },
        ]),
        upsert: vi.fn(),
      },
    } as const;

    await seedDefaultCostRatesIfEmpty(repos, '2026-04-14');

    expect(repos.costRates.upsert).not.toHaveBeenCalled();
  });
});
