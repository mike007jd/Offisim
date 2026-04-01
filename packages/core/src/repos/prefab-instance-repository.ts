import type { PrefabInstanceRow } from '@offisim/shared-types';

export interface PrefabInstanceRepository {
  create(instance: PrefabInstanceRow): Promise<PrefabInstanceRow>;
  findById(instanceId: string): Promise<PrefabInstanceRow | null>;
  findByCompanyAndZone(companyId: string, zoneId: string): Promise<PrefabInstanceRow[]>;
  findByCompany(companyId: string): Promise<PrefabInstanceRow[]>;
  update(
    instanceId: string,
    fields: Partial<
      Pick<
        PrefabInstanceRow,
        | 'position_x'
        | 'position_y'
        | 'rotation'
        | 'zone_id'
        | 'bindings_json'
        | 'config_json'
        | 'enabled'
      >
    >,
  ): Promise<void>;
  delete(instanceId: string): Promise<void>;
  deleteByCompany(companyId: string): Promise<void>;
}
