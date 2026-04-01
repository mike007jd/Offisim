import { type RuntimeRepositories, dehydrateZone } from '@offisim/core/browser';
import type { PrefabStateChangedPayload, RuntimeEvent, Zone } from '@offisim/shared-types';
import type { PlacedInstance } from '../components/studio/StudioState.js';

const STUDIO_TEMP_PREFIX = 'sp-';

interface ZonePersistenceEventBus {
  emit: (event: RuntimeEvent<PrefabStateChangedPayload>) => void;
}

function normalizeZoneId(companyId: string, zoneId: string): string {
  return zoneId.includes('::') ? zoneId : `${companyId}::${zoneId}`;
}

export async function saveZonesToDb(
  repos: Pick<RuntimeRepositories, 'prefabInstances' | 'zones'>,
  companyId: string,
  zones: Zone[],
  prefabInstances: PlacedInstance[],
  eventBus: ZonePersistenceEventBus,
): Promise<void> {
  await repos.prefabInstances.deleteByCompany(companyId);
  await repos.zones.deleteByCompany(companyId);

  const zoneIdMap = new Map<string, string>();
  for (const [index, zone] of zones.entries()) {
    const normalizedZoneId = normalizeZoneId(companyId, zone.zoneId);
    zoneIdMap.set(zone.zoneId, normalizedZoneId);
    await repos.zones.create(
      dehydrateZone({
        ...zone,
        zoneId: normalizedZoneId,
        companyId,
        sortOrder: index,
      }),
    );
  }

  const now = new Date().toISOString();
  for (const instance of prefabInstances) {
    await repos.prefabInstances.create({
      instance_id: instance.id.startsWith(STUDIO_TEMP_PREFIX) ? crypto.randomUUID() : instance.id,
      company_id: companyId,
      prefab_id: instance.prefabId,
      zone_id: zoneIdMap.get(instance.zoneId) ?? normalizeZoneId(companyId, instance.zoneId),
      position_x: Number.parseFloat(instance.position[0].toFixed(4)),
      position_y: Number.parseFloat(instance.position[2].toFixed(4)),
      rotation: instance.rotation,
      bindings_json: null,
      config_json: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    });
  }

  eventBus.emit({
    type: 'prefab.state.changed',
    entityId: companyId,
    entityType: 'prefab',
    companyId,
    timestamp: Date.now(),
    payload: {
      instanceId: companyId,
      prefabId: '__studio__',
      category: 'studio',
      prev: 'saved',
      next: 'saved',
    },
  });
}
