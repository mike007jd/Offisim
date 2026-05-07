import { hydrateZone } from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';
import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import {
  SYSTEM_PREFAB_LAYOUT_VERSION,
  SYSTEM_ZONE_TEMPLATES,
  getSystemZoneDefaultPrefabs,
  normalizeZoneId,
  resolveZoneForRole,
  templateToZone,
} from '@offisim/shared-types';

const POLICY_LAYOUT_VERSION_KEY = 'systemPrefabLayoutVersion';
const inFlightRepairs = new Map<string, Promise<void>>();

function now(): string {
  return new Date().toISOString();
}

function parsePolicy(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function createPrefabInstance(params: {
  companyId: string;
  prefabId: string;
  zoneId: string;
  x: number;
  z: number;
  rotation?: 0 | 90 | 180 | 270;
  timestamp: string;
}): PrefabInstanceRow {
  return {
    instance_id: crypto.randomUUID(),
    company_id: params.companyId,
    prefab_id: params.prefabId,
    zone_id: params.zoneId,
    position_x: Number.parseFloat(params.x.toFixed(4)),
    position_y: Number.parseFloat(params.z.toFixed(4)),
    rotation: params.rotation ?? 0,
    bindings_json: null,
    config_json: null,
    enabled: 1,
    created_at: params.timestamp,
    updated_at: params.timestamp,
  };
}

async function loadSystemZones(repos: RuntimeRepositories, companyId: string): Promise<Zone[]> {
  const zoneRows = await repos.zones.findByCompany(companyId);
  const zones =
    zoneRows.length > 0
      ? zoneRows.map((row) => hydrateZone(row))
      : SYSTEM_ZONE_TEMPLATES.map((template) => templateToZone(template, companyId));
  return zones.filter((zone) => zone.kind === 'system');
}

async function buildEmployeeCountsByZone(
  repos: RuntimeRepositories,
  companyId: string,
  zones: readonly Zone[],
): Promise<Map<string, number>> {
  const employees = await repos.employees.findByCompany(companyId);
  const counts = new Map<string, number>();
  for (const employee of employees) {
    const zone = resolveZoneForRole(employee.role_slug, zones);
    if (zone?.archetype !== 'workspace') continue;
    counts.set(zone.zoneId, (counts.get(zone.zoneId) ?? 0) + 1);
  }
  return counts;
}

function buildSystemPrefabs(
  companyId: string,
  zones: readonly Zone[],
  employeeCountsByZone: ReadonlyMap<string, number>,
): PrefabInstanceRow[] {
  const timestamp = now();
  const rows: PrefabInstanceRow[] = [];
  for (const zone of zones) {
    const placements = getSystemZoneDefaultPrefabs(zone, {
      occupiedSeats: employeeCountsByZone.get(zone.zoneId),
    });
    for (const prefab of placements) {
      rows.push(
        createPrefabInstance({
          companyId,
          prefabId: prefab.prefabId,
          zoneId: normalizeZoneId(companyId, zone.zoneId),
          x: zone.cx + prefab.offsetX,
          z: zone.cz + prefab.offsetZ,
          rotation: prefab.rotation,
          timestamp,
        }),
      );
    }
  }
  return rows;
}

async function runSystemPrefabLayoutRepair(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<void> {
  const company = await repos.companies.findById(companyId);
  if (!company) return;

  const policy = parsePolicy(company.default_model_policy_json);
  if (policy[POLICY_LAYOUT_VERSION_KEY] === SYSTEM_PREFAB_LAYOUT_VERSION) {
    return;
  }

  const systemZones = await loadSystemZones(repos, companyId);
  if (systemZones.length === 0) {
    return;
  }

  const employeeCountsByZone = await buildEmployeeCountsByZone(repos, companyId, systemZones);
  const nextRows = buildSystemPrefabs(companyId, systemZones, employeeCountsByZone);
  const systemZoneIds = new Set(systemZones.map((zone) => normalizeZoneId(companyId, zone.zoneId)));
  const currentRows = await repos.prefabInstances.findByCompany(companyId);

  for (const row of currentRows) {
    if (systemZoneIds.has(row.zone_id)) {
      await repos.prefabInstances.delete(row.instance_id);
    }
  }
  for (const row of nextRows) {
    await repos.prefabInstances.create(row);
  }

  await repos.companies.update(companyId, {
    default_model_policy_json: JSON.stringify({
      ...policy,
      [POLICY_LAYOUT_VERSION_KEY]: SYSTEM_PREFAB_LAYOUT_VERSION,
    }),
  });
}

export function ensureSystemPrefabLayoutVersion(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<void> {
  const existing = inFlightRepairs.get(companyId);
  if (existing) return existing;

  const repair = runSystemPrefabLayoutRepair(repos, companyId).finally(() => {
    inFlightRepairs.delete(companyId);
  });
  inFlightRepairs.set(companyId, repair);
  return repair;
}
