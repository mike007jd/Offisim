import { describe, expect, it } from 'vitest';
import { MemoryModelCostRateRepository } from '../../runtime/memory-repositories.js';

describe('MemoryModelCostRateRepository', () => {
  function createRepo() {
    return new MemoryModelCostRateRepository();
  }

  it('creates a rate and returns it with generated id and timestamp', async () => {
    const repo = createRepo();
    const row = await repo.create({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });
    expect(row.rate_id).toBeDefined();
    expect(row.provider).toBe('openai');
    expect(row.model_pattern).toBe('gpt-4o*');
    expect(row.input_cost_per_mtok).toBe(2.5);
    expect(row.output_cost_per_mtok).toBe(10);
    expect(row.created_at).toBeDefined();
  });

  it('findByProviderModel matches exact pattern', async () => {
    const repo = createRepo();
    await repo.create({
      provider: 'openai',
      model_pattern: 'gpt-4o',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    const found = await repo.findByProviderModel('openai', 'gpt-4o');
    expect(found).not.toBeNull();
    expect(found!.model_pattern).toBe('gpt-4o');
  });

  it('findByProviderModel matches glob pattern', async () => {
    const repo = createRepo();
    await repo.create({
      provider: 'anthropic',
      model_pattern: 'claude-3.5-sonnet*',
      input_cost_per_mtok: 3,
      output_cost_per_mtok: 15,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    const found = await repo.findByProviderModel('anthropic', 'claude-3.5-sonnet-20241022');
    expect(found).not.toBeNull();
    expect(found!.model_pattern).toBe('claude-3.5-sonnet*');
  });

  it('findByProviderModel returns null for no match', async () => {
    const repo = createRepo();
    await repo.create({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    expect(await repo.findByProviderModel('openai', 'gpt-3.5-turbo')).toBeNull();
    expect(await repo.findByProviderModel('anthropic', 'gpt-4o')).toBeNull();
  });

  it('findAll returns all rates', async () => {
    const repo = createRepo();
    await repo.create({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });
    await repo.create({
      provider: 'anthropic',
      model_pattern: 'claude-3*',
      input_cost_per_mtok: 3,
      output_cost_per_mtok: 15,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('upsert creates new if not existing', async () => {
    const repo = createRepo();
    const row = await repo.upsert({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });
    expect(row.rate_id).toBeDefined();
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('upsert updates existing if provider+pattern+effective_from match', async () => {
    const repo = createRepo();
    await repo.create({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 10,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    const updated = await repo.upsert({
      provider: 'openai',
      model_pattern: 'gpt-4o*',
      input_cost_per_mtok: 3.0,
      output_cost_per_mtok: 12,
      effective_from: '2026-01-01',
      effective_until: null,
    });

    expect(updated.input_cost_per_mtok).toBe(3.0);
    expect(updated.output_cost_per_mtok).toBe(12);
    expect(await repo.findAll()).toHaveLength(1);
  });
});
