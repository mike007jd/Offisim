import type { ZoneRow } from '@aics/shared-types';

export type NewZone = Omit<ZoneRow, 'created_at' | 'updated_at'>;

export interface ZoneRepository {
  create(zone: NewZone): Promise<ZoneRow>;
  findById(zoneId: string): Promise<ZoneRow | null>;
  findByCompany(companyId: string): Promise<ZoneRow[]>;
  update(
    zoneId: string,
    fields: Partial<
      Pick<
        ZoneRow,
        | 'label'
        | 'accent_color'
        | 'floor_color'
        | 'cx'
        | 'cz'
        | 'w'
        | 'd'
        | 'target_roles_json'
        | 'allowed_categories_json'
        | 'activity_types_json'
        | 'desk_slots'
        | 'sort_order'
        | 'archetype'
      >
    >,
  ): Promise<void>;
  delete(zoneId: string): Promise<void>;
  deleteByCompany(companyId: string): Promise<void>;
}
