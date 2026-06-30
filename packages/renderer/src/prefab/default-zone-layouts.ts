/**
 * Default zone layout configurations.
 *
 * Returns a list of prefab placements for a given zone type,
 * providing sensible starting furniture when a zone is first created.
 *
 * Positions are relative offsets within the zone coordinate space.
 * The actual world position is computed at placement time by the
 * scene entity manager.
 */

import { getSystemZoneDefaultPrefabs } from '@offisim/shared-types';
import type { ZoneArchetype } from '@offisim/shared-types';

// ── Types ───────────────────────────────────────────────────────

export interface DefaultPrefabPlacement {
  prefabId: string;
  position?: [number, number];
  rotation?: 0 | 90 | 180 | 270;
}

type ZoneLayoutType =
  | 'department'
  | 'library'
  | 'rest_area'
  | 'meeting_room'
  | 'server_room';

// ── Layout generators ───────────────────────────────────────────

function fromSystemLayout(
  slug: string,
  archetype: ZoneArchetype,
  count?: number,
): DefaultPrefabPlacement[] {
  return getSystemZoneDefaultPrefabs(
    {
      slug,
      archetype,
      deskSlots: count ?? (archetype === 'workspace' ? 4 : 0),
    },
    { occupiedSeats: count },
  ).map((prefab) => ({
    prefabId: prefab.prefabId,
    position: [prefab.offsetX, prefab.offsetZ],
    ...(prefab.rotation !== undefined ? { rotation: prefab.rotation } : {}),
  }));
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Returns the default prefab placement list for a zone type.
 *
 * @param zoneType  - The kind of zone being created.
 * @param count     - For `department`: number of workstations.
 *                    For `server_room`: number of racks.
 *                    For `meeting_room`: expected seat count (picks table size).
 *                    Ignored for other zone types.
 */
export function getDefaultZoneLayout(
  zoneType: ZoneLayoutType,
  count?: number,
): DefaultPrefabPlacement[] {
  switch (zoneType) {
    case 'department':
      return fromSystemLayout('zone-dev', 'workspace', count ?? 4);
    case 'library':
      return fromSystemLayout('zone-library', 'library');
    case 'rest_area':
      return fromSystemLayout('zone-rest', 'rest');
    case 'meeting_room':
      return fromSystemLayout('zone-meeting', 'meeting', count ?? 8);
    case 'server_room':
      return fromSystemLayout('zone-server', 'server', count ?? 4);
  }
}
