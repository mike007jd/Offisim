import type {
  ActivityType,
  RoleSlug,
  SemanticCategory,
  Zone,
  ZoneArchetype,
  ZoneRow,
} from '@offisim/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone } from '@offisim/shared-types';

import type { ZoneRepository, NewZone } from '../repos/zone-repository.js';

// ── Hydration helpers ──────────────────────────────────────────────

function parseJsonArray<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function hydrateZone(row: ZoneRow): Zone {
  return {
    zoneId: row.zone_id,
    companyId: row.company_id,
    kind: row.kind as Zone['kind'],
    archetype: row.archetype as ZoneArchetype | null,
    label: row.label,
    accentColor: row.accent_color,
    floorColor: row.floor_color,
    cx: row.cx,
    cz: row.cz,
    w: row.w,
    d: row.d,
    targetRoles: parseJsonArray<RoleSlug>(row.target_roles_json),
    allowedCategories: parseJsonArray<SemanticCategory>(row.allowed_categories_json),
    activityTypes: parseJsonArray<ActivityType>(row.activity_types_json),
    deskSlots: row.desk_slots,
    sortOrder: row.sort_order,
  };
}

export function dehydrateZone(zone: Zone): NewZone {
  return {
    zone_id: zone.zoneId,
    company_id: zone.companyId,
    kind: zone.kind,
    archetype: zone.archetype,
    label: zone.label,
    accent_color: zone.accentColor,
    floor_color: zone.floorColor,
    cx: zone.cx,
    cz: zone.cz,
    w: zone.w,
    d: zone.d,
    target_roles_json:
      zone.targetRoles.length > 0 ? JSON.stringify(zone.targetRoles) : null,
    allowed_categories_json:
      zone.allowedCategories.length > 0 ? JSON.stringify(zone.allowedCategories) : null,
    activity_types_json:
      zone.activityTypes.length > 0 ? JSON.stringify(zone.activityTypes) : null,
    desk_slots: zone.deskSlots,
    sort_order: zone.sortOrder,
  };
}

// ── Service ────────────────────────────────────────────────────────

export class ZoneService {
  constructor(private readonly repo: ZoneRepository) {}

  async getCompanyZones(companyId: string): Promise<Zone[]> {
    const rows = await this.repo.findByCompany(companyId);
    return rows.map(hydrateZone);
  }

  /**
   * Seed the 7 system zones for a newly created company.
   * Uses SYSTEM_ZONE_TEMPLATES as the single source of truth.
   */
  async seedSystemZones(companyId: string): Promise<Zone[]> {
    const zones: Zone[] = [];

    for (const t of SYSTEM_ZONE_TEMPLATES) {
      const zone = templateToZone(t, companyId);
      const newZone: NewZone = {
        ...dehydrateZone(zone),
        zone_id: `${companyId}::${t.slug}`,
      };
      const row = await this.repo.create(newZone);
      zones.push(hydrateZone(row));
    }

    return zones;
  }

  async createCustomZone(
    companyId: string,
    params: {
      label: string;
      archetype?: ZoneArchetype | null;
      accentColor?: string;
      floorColor?: number;
      cx: number;
      cz: number;
      w: number;
      d: number;
      targetRoles?: RoleSlug[];
      allowedCategories?: SemanticCategory[];
      activityTypes?: ActivityType[];
      deskSlots?: number;
    },
  ): Promise<Zone> {
    const newZone: NewZone = {
      zone_id: `zone-custom-${crypto.randomUUID()}`,
      company_id: companyId,
      kind: 'custom',
      archetype: params.archetype ?? null,
      label: params.label,
      accent_color: params.accentColor ?? '#64748b',
      floor_color: params.floorColor ?? 0x334155,
      cx: params.cx,
      cz: params.cz,
      w: params.w,
      d: params.d,
      target_roles_json:
        params.targetRoles && params.targetRoles.length > 0
          ? JSON.stringify(params.targetRoles)
          : null,
      allowed_categories_json:
        params.allowedCategories && params.allowedCategories.length > 0
          ? JSON.stringify(params.allowedCategories)
          : null,
      activity_types_json:
        params.activityTypes && params.activityTypes.length > 0
          ? JSON.stringify(params.activityTypes)
          : null,
      desk_slots: params.deskSlots ?? 0,
      sort_order: 100,
    };

    const row = await this.repo.create(newZone);
    return hydrateZone(row);
  }

  async updateZone(
    zoneId: string,
    patch: Partial<
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
  ): Promise<void> {
    await this.repo.update(zoneId, patch);
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.repo.delete(zoneId);
  }
}
