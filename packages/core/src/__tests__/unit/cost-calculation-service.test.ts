import { describe, expect, it } from 'vitest';
import { CostCalculationService } from '../../runtime/cost-calculation-service.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { DEFAULT_COST_RATES } from '../../runtime/default-cost-rates.js';
import type { LlmCallRow } from '../../runtime/repositories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlmCall(overrides: Partial<LlmCallRow> = {}): LlmCallRow {
  return {
    llm_call_id: crypto.randomUUID(),
    thread_id: 'thread-001',
    task_run_id: null,
    node_name: 'boss',
    provider: 'openai',
    model: 'gpt-4o',
    input_tokens: 1000,
    output_tokens: 500,
    usage_raw_json: null,
    response_json: null,
    latency_ms: 200,
    error_code: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function seedRates(repos: ReturnType<typeof createMemoryRepositories>) {
  const now = new Date().toISOString().slice(0, 10);
  for (const rate of DEFAULT_COST_RATES) {
    await repos.costRates.create({
      provider: rate.provider,
      model_pattern: rate.model_pattern,
      input_cost_per_mtok: rate.input_cost_per_mtok,
      output_cost_per_mtok: rate.output_cost_per_mtok,
      effective_from: now,
      effective_until: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CostCalculationService', () => {
  describe('findRate', () => {
    it('finds exact pattern match', async () => {
      const repos = createMemoryRepositories();
      await repos.costRates.create({
        provider: 'openai',
        model_pattern: 'gpt-4o',
        input_cost_per_mtok: 2.5,
        output_cost_per_mtok: 10,
        effective_from: '2026-01-01',
        effective_until: null,
      });
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

      const rate = await service.findRate('openai', 'gpt-4o');
      expect(rate).not.toBeNull();
      expect(rate!.input_cost_per_mtok).toBe(2.5);
    });

    it('finds wildcard pattern match', async () => {
      const repos = createMemoryRepositories();
      await repos.costRates.create({
        provider: 'anthropic',
        model_pattern: 'claude-3.5-sonnet*',
        input_cost_per_mtok: 3,
        output_cost_per_mtok: 15,
        effective_from: '2026-01-01',
        effective_until: null,
      });
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

      const rate = await service.findRate('anthropic', 'claude-3.5-sonnet-20241022');
      expect(rate).not.toBeNull();
      expect(rate!.input_cost_per_mtok).toBe(3);
    });

    it('returns null for no match', async () => {
      const repos = createMemoryRepositories();
      await repos.costRates.create({
        provider: 'openai',
        model_pattern: 'gpt-4o*',
        input_cost_per_mtok: 2.5,
        output_cost_per_mtok: 10,
        effective_from: '2026-01-01',
        effective_until: null,
      });
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

      expect(await service.findRate('openai', 'gpt-3.5-turbo')).toBeNull();
      expect(await service.findRate('anthropic', 'gpt-4o')).toBeNull();
    });
  });

  describe('calculateCallCost', () => {
    it('calculates input + output costs correctly', async () => {
      const repos = createMemoryRepositories();
      await repos.costRates.create({
        provider: 'openai',
        model_pattern: 'gpt-4o*',
        input_cost_per_mtok: 2.5,
        output_cost_per_mtok: 10,
        effective_from: '2026-01-01',
        effective_until: null,
      });
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

      const call = makeLlmCall({
        provider: 'openai',
        model: 'gpt-4o',
        input_tokens: 1_000_000, // 1M tokens
        output_tokens: 500_000,  // 0.5M tokens
      });

      const result = await service.calculateCallCost(call);
      expect(result.rateFound).toBe(true);
      expect(result.inputCost).toBeCloseTo(2.5); // 1M * 2.5/MTok
      expect(result.outputCost).toBeCloseTo(5.0); // 0.5M * 10/MTok
      expect(result.totalCost).toBeCloseTo(7.5);
    });

    it('returns zero cost when rate not found', async () => {
      const repos = createMemoryRepositories();
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

      const call = makeLlmCall({ provider: 'unknown', model: 'unknown-model' });
      const result = await service.calculateCallCost(call);

      expect(result.rateFound).toBe(false);
      expect(result.totalCost).toBe(0);
      expect(result.inputCost).toBe(0);
      expect(result.outputCost).toBe(0);
    });

    it('handles small token counts accurately', async () => {
      const repos = createMemoryRepositories();
      await repos.costRates.create({
        provider: 'openai',
        model_pattern: 'gpt-4o-mini*',
        input_cost_per_mtok: 0.15,
        output_cost_per_mtok: 0.6,
        effective_from: '2026-01-01',
        effective_until: null,
      });
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

      const call = makeLlmCall({
        provider: 'openai',
        model: 'gpt-4o-mini',
        input_tokens: 500,
        output_tokens: 200,
      });

      const result = await service.calculateCallCost(call);
      expect(result.rateFound).toBe(true);
      // 500 / 1M * 0.15 = 0.000075
      expect(result.inputCost).toBeCloseTo(0.000075, 8);
      // 200 / 1M * 0.6 = 0.00012
      expect(result.outputCost).toBeCloseTo(0.00012, 8);
    });
  });

  describe('aggregateCosts', () => {
    it('aggregates by model across threads', async () => {
      const repos = createMemoryRepositories();
      await seedRates(repos);

      // Create thread + calls
      await repos.threads.create({
        thread_id: 'thread-001',
        company_id: 'company-001',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });

      await repos.llmCalls.create(makeLlmCall({
        provider: 'openai',
        model: 'gpt-4o',
        input_tokens: 1000,
        output_tokens: 500,
        created_at: '2026-03-12T10:00:00.000Z',
      }));
      await repos.llmCalls.create(makeLlmCall({
        provider: 'openai',
        model: 'gpt-4o',
        input_tokens: 2000,
        output_tokens: 1000,
        created_at: '2026-03-12T11:00:00.000Z',
      }));

      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);
      const agg = await service.aggregateCosts('company-001', { groupBy: 'model' });

      expect(agg.length).toBe(1);
      expect(agg[0]!.groupKey).toBe('openai/gpt-4o');
      expect(agg[0]!.callCount).toBe(2);
      expect(agg[0]!.inputTokens).toBe(3000);
      expect(agg[0]!.outputTokens).toBe(1500);
    });

    it('aggregates by day', async () => {
      const repos = createMemoryRepositories();
      await seedRates(repos);

      await repos.threads.create({
        thread_id: 'thread-001',
        company_id: 'company-001',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });

      await repos.llmCalls.create(makeLlmCall({
        created_at: '2026-03-11T10:00:00.000Z',
      }));
      await repos.llmCalls.create(makeLlmCall({
        created_at: '2026-03-12T10:00:00.000Z',
      }));

      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);
      const agg = await service.aggregateCosts('company-001', { groupBy: 'day' });

      expect(agg.length).toBe(2);
      const keys = agg.map((a) => a.groupKey).sort();
      expect(keys).toEqual(['2026-03-11', '2026-03-12']);
    });

    it('filters by time range', async () => {
      const repos = createMemoryRepositories();
      await seedRates(repos);

      await repos.threads.create({
        thread_id: 'thread-001',
        company_id: 'company-001',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });

      await repos.llmCalls.create(makeLlmCall({
        created_at: '2026-03-10T10:00:00.000Z',
      }));
      await repos.llmCalls.create(makeLlmCall({
        created_at: '2026-03-12T10:00:00.000Z',
      }));

      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);
      const agg = await service.aggregateCosts('company-001', {
        from: '2026-03-12T00:00:00.000Z',
      });

      expect(agg.length).toBe(1);
      expect(agg[0]!.callCount).toBe(1);
    });

    it('returns empty array for company with no threads', async () => {
      const repos = createMemoryRepositories();
      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);
      const agg = await service.aggregateCosts('no-such-company');
      expect(agg).toEqual([]);
    });

    it('returns zero cost when no rates match', async () => {
      const repos = createMemoryRepositories();
      // No cost rates seeded

      await repos.threads.create({
        thread_id: 'thread-001',
        company_id: 'company-001',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });

      await repos.llmCalls.create(makeLlmCall({
        provider: 'unknown-provider',
        model: 'unknown-model',
      }));

      const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);
      const agg = await service.aggregateCosts('company-001');

      expect(agg.length).toBe(1);
      expect(agg[0]!.totalCost).toBe(0);
      expect(agg[0]!.callCount).toBe(1);
    });
  });
});

describe('DEFAULT_COST_RATES', () => {
  it('all entries have valid structure', () => {
    for (const rate of DEFAULT_COST_RATES) {
      expect(rate.provider).toBeTruthy();
      expect(rate.model_pattern).toBeTruthy();
      expect(rate.input_cost_per_mtok).toBeGreaterThanOrEqual(0);
      expect(rate.output_cost_per_mtok).toBeGreaterThanOrEqual(0);
      expect(typeof rate.provider).toBe('string');
      expect(typeof rate.model_pattern).toBe('string');
      expect(typeof rate.input_cost_per_mtok).toBe('number');
      expect(typeof rate.output_cost_per_mtok).toBe('number');
    }
  });

  it('contains rates for major providers', () => {
    const providers = new Set(DEFAULT_COST_RATES.map((r) => r.provider));
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('anthropic')).toBe(true);
    expect(providers.has('openai-compat')).toBe(true);
  });

  it('has at least 8 rate entries', () => {
    expect(DEFAULT_COST_RATES.length).toBeGreaterThanOrEqual(8);
  });
});
