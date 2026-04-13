import * as schema from '@offisim/db-local';
import { describe, expect, it, vi } from 'vitest';

import { createTauriRepositories } from '../tauri-repos';

describe('createTauriRepositories', () => {
  it('exposes agent event and recovery knowledge repositories for runtime parity', () => {
    const repos = createTauriRepositories({} as never);

    expect(repos.agentEvents).toBeDefined();
    expect(repos.recoveryKnowledge).toBeDefined();
    expect(typeof repos.agentEvents?.append).toBe('function');
    expect(typeof repos.agentEvents?.findRecent).toBe('function');
    expect(typeof repos.recoveryKnowledge?.upsert).toBe('function');
    expect(typeof repos.recoveryKnowledge?.findBestFix).toBe('function');
  });

  it('costRates.upsert uses onConflictDoUpdate on the unique provider/model/effective_from key', async () => {
    let conflictConfig: { target?: unknown; set?: unknown } | null = null;
    const persistedRow = {
      rate_id: 'mcr-1',
      provider: 'openai',
      model_pattern: 'gpt-4o',
      input_cost_per_mtok: 3,
      output_cost_per_mtok: 12,
      effective_from: '2026-04-14',
      effective_until: null,
      created_at: '2026-04-14T00:00:00.000Z',
    };

    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn((config) => {
            conflictConfig = config;
            return Promise.resolve();
          }),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([persistedRow]),
        })),
      })),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const repos = createTauriRepositories(db as never);
    const row = await repos.costRates.upsert({
      provider: 'openai',
      model_pattern: 'gpt-4o',
      input_cost_per_mtok: 3,
      output_cost_per_mtok: 12,
      effective_from: '2026-04-14',
      effective_until: null,
    });

    expect(row).toEqual(persistedRow);
    expect(conflictConfig).not.toBeNull();
    const appliedConflict: { target?: unknown; set?: unknown } | null = conflictConfig;
    if (!appliedConflict) {
      throw new Error('Expected onConflictDoUpdate config to be captured.');
    }
    expect((appliedConflict as Record<string, unknown>).target).toEqual([
      schema.modelCostRates.provider,
      schema.modelCostRates.model_pattern,
      schema.modelCostRates.effective_from,
    ]);
  });
});
