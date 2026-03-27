import type { PrefabInstanceRow } from '@aics/shared-types';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';

function now(): string {
  return new Date().toISOString();
}

export class MemoryPrefabInstanceRepository implements PrefabInstanceRepository {
  private store = new Map<string, PrefabInstanceRow>();

  constructor(initialRows?: Iterable<PrefabInstanceRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.instance_id, { ...row });
    }
  }

  async create(instance: PrefabInstanceRow): Promise<PrefabInstanceRow> {
    this.store.set(instance.instance_id, { ...instance });
    return { ...instance };
  }

  async findById(instanceId: string): Promise<PrefabInstanceRow | null> {
    const row = this.store.get(instanceId);
    return row ? { ...row } : null;
  }

  async findByCompanyAndZone(companyId: string, zoneId: string): Promise<PrefabInstanceRow[]> {
    return [...this.store.values()].filter(
      (r) => r.company_id === companyId && r.zone_id === zoneId,
    );
  }

  async findByCompany(companyId: string): Promise<PrefabInstanceRow[]> {
    return [...this.store.values()].filter((r) => r.company_id === companyId);
  }

  async update(
    instanceId: string,
    fields: Partial<
      Pick<
        PrefabInstanceRow,
        'position_x' | 'position_y' | 'rotation' | 'bindings_json' | 'config_json' | 'enabled'
      >
    >,
  ): Promise<void> {
    const row = this.store.get(instanceId);
    if (row) {
      this.store.set(instanceId, { ...row, ...fields, updated_at: now() });
    }
  }

  async delete(instanceId: string): Promise<void> {
    this.store.delete(instanceId);
  }

  async deleteByCompany(companyId: string): Promise<void> {
    for (const [id, row] of this.store) {
      if (row.company_id === companyId) {
        this.store.delete(id);
      }
    }
  }

  snapshot(): PrefabInstanceRow[] {
    return [...this.store.values()].map((row) => ({ ...row }));
  }
}

export function createMemoryPrefabRepository(
  snapshot?: Iterable<PrefabInstanceRow>,
): MemoryPrefabInstanceRepository {
  return new MemoryPrefabInstanceRepository(snapshot);
}
