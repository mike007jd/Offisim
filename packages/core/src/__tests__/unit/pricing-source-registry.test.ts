import { describe, expect, it } from 'vitest';
import { DEFAULT_COST_RATES } from '../../runtime/default-cost-rates.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import {
  ModelCostRatePricingSource,
  PricingSourceRegistry,
  StaticPricingSource,
} from '../../runtime/pricing-source-registry.js';

describe('PricingSourceRegistry', () => {
  it('resolves provider/model pricing from configured cost rates with exact confidence', async () => {
    const repos = createMemoryRepositories();
    await repos.costRates.create({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    const registry = new PricingSourceRegistry([
      new ModelCostRatePricingSource(repos.costRates, 'configured_rates', 'exact'),
    ]);

    const resolution = await registry.resolve('openai', 'gpt-4o');
    expect(resolution).toEqual(
      expect.objectContaining({
        source: 'configured_rates',
        confidence: 'exact',
        matchedPattern: 'gpt-4o*',
      }),
    );
  });

  it('falls through to later sources when earlier ones do not match', async () => {
    const repos = createMemoryRepositories();
    const registry = new PricingSourceRegistry([
      new ModelCostRatePricingSource(repos.costRates, 'configured_rates', 'exact'),
      new StaticPricingSource(
        [
          ...DEFAULT_COST_RATES,
          {
            provider: 'openrouter',
            model_pattern: 'openai/gpt-4o-mini*',
            input_cost_per_mtok: 0.2,
            output_cost_per_mtok: 0.8,
          },
        ],
        'catalog:openrouter',
        'catalog',
      ),
    ]);

    const resolution = await registry.resolve('openrouter', 'openai/gpt-4o-mini');
    expect(resolution).toEqual(
      expect.objectContaining({
        source: 'catalog:openrouter',
        confidence: 'catalog',
      }),
    );
  });

  it('returns unknown estimate when no source can price the model', async () => {
    const repos = createMemoryRepositories();
    const registry = new PricingSourceRegistry([
      new ModelCostRatePricingSource(repos.costRates, 'configured_rates', 'exact'),
    ]);

    const estimate = await registry.estimateUsage({
      provider: 'mystery',
      model: 'opaque-1',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(estimate.totalCost).toBe(0);
    expect(estimate.rateFound).toBe(false);
    expect(estimate.confidence).toBe('unknown');
    expect(estimate.source).toBe('unknown');
  });
});
