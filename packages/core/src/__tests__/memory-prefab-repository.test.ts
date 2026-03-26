import type { PrefabInstanceRow } from '@aics/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryPrefabRepository } from '../runtime/memory-prefab-repository.js';

function makePrefabInstance(overrides?: Partial<PrefabInstanceRow>): PrefabInstanceRow {
  return {
    instance_id: `pi-${Math.random().toString(36).slice(2, 8)}`,
    company_id: 'co-1',
    prefab_id: 'workstation-standard',
    zone_id: 'zone-dev',
    position_x: 0,
    position_y: 0,
    rotation: 0,
    bindings_json: null,
    config_json: null,
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MemoryPrefabInstanceRepository', () => {
  it('create() stores and returns the row', async () => {
    const repo = createMemoryPrefabRepository();
    const input = makePrefabInstance({ instance_id: 'pi-1' });
    const result = await repo.create(input);

    expect(result).toEqual(input);

    const found = await repo.findById('pi-1');
    expect(found).toEqual(input);
  });

  it('findById() returns null for missing ID', async () => {
    const repo = createMemoryPrefabRepository();
    expect(await repo.findById('nonexistent')).toBeNull();
  });

  it('findByCompanyAndZone() filters correctly', async () => {
    const repo = createMemoryPrefabRepository();
    await repo.create(
      makePrefabInstance({ instance_id: 'pi-1', company_id: 'co-1', zone_id: 'zone-dev' }),
    );
    await repo.create(
      makePrefabInstance({ instance_id: 'pi-2', company_id: 'co-1', zone_id: 'zone-art' }),
    );
    await repo.create(
      makePrefabInstance({ instance_id: 'pi-3', company_id: 'co-2', zone_id: 'zone-dev' }),
    );

    const results = await repo.findByCompanyAndZone('co-1', 'zone-dev');
    expect(results).toHaveLength(1);
    expect(results[0]?.instance_id).toBe('pi-1');
  });

  it('findByCompany() returns all for a company', async () => {
    const repo = createMemoryPrefabRepository();
    await repo.create(
      makePrefabInstance({ instance_id: 'pi-1', company_id: 'co-1', zone_id: 'zone-dev' }),
    );
    await repo.create(
      makePrefabInstance({ instance_id: 'pi-2', company_id: 'co-1', zone_id: 'zone-art' }),
    );
    await repo.create(
      makePrefabInstance({ instance_id: 'pi-3', company_id: 'co-2', zone_id: 'zone-dev' }),
    );

    const results = await repo.findByCompany('co-1');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.instance_id).sort()).toEqual(['pi-1', 'pi-2']);
  });

  it('update() changes specified fields and updates updated_at', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repo = createMemoryPrefabRepository();
    const original = makePrefabInstance({ instance_id: 'pi-1', position_x: 0, rotation: 0 });
    await repo.create(original);

    vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    await repo.update('pi-1', { position_x: 100, rotation: 90 });

    const updated = await repo.findById('pi-1');
    expect(updated).not.toBeNull();
    expect(updated?.position_x).toBe(100);
    expect(updated?.rotation).toBe(90);
    expect(updated?.updated_at).toBe('2026-01-01T01:00:00.000Z');
    expect(updated?.updated_at).not.toBe(original.updated_at);
    // Fields not in the update should remain unchanged
    expect(updated?.position_y).toBe(original.position_y);
    expect(updated?.prefab_id).toBe(original.prefab_id);

    vi.useRealTimers();
  });

  it('update() is a no-op for missing ID', async () => {
    const repo = createMemoryPrefabRepository();
    // Should not throw
    await repo.update('nonexistent', { enabled: 0 });
  });

  it('delete() removes a single instance', async () => {
    const repo = createMemoryPrefabRepository();
    await repo.create(makePrefabInstance({ instance_id: 'pi-1' }));
    await repo.create(makePrefabInstance({ instance_id: 'pi-2' }));

    await repo.delete('pi-1');

    expect(await repo.findById('pi-1')).toBeNull();
    expect(await repo.findById('pi-2')).not.toBeNull();
  });

  it('deleteByCompany() removes all instances for a company', async () => {
    const repo = createMemoryPrefabRepository();
    await repo.create(makePrefabInstance({ instance_id: 'pi-1', company_id: 'co-1' }));
    await repo.create(makePrefabInstance({ instance_id: 'pi-2', company_id: 'co-1' }));
    await repo.create(makePrefabInstance({ instance_id: 'pi-3', company_id: 'co-2' }));

    await repo.deleteByCompany('co-1');

    expect(await repo.findById('pi-1')).toBeNull();
    expect(await repo.findById('pi-2')).toBeNull();
    expect(await repo.findById('pi-3')).not.toBeNull();
  });
});
