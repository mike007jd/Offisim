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

// ── Types ───────────────────────────────────────────────────────

export interface DefaultPrefabPlacement {
  prefabId: string;
  position?: [number, number];
  rotation?: 0 | 90 | 180 | 270;
}

export type ZoneLayoutType =
  | 'department'
  | 'library'
  | 'rest_area'
  | 'meeting_room'
  | 'server_room';

// ── Layout generators ───────────────────────────────────────────

/** Horizontal spacing between workstation columns. */
const WS_SPACING_X = 70;
/** Vertical offset for first workstation row. */
const WS_START_Y = 20;
/** How many workstations per row before wrapping. */
const WS_PER_ROW = 4;
/** Row-to-row vertical gap. */
const WS_ROW_GAP = 60;

function departmentLayout(count: number): DefaultPrefabPlacement[] {
  const n = Math.max(1, count);
  const placements: DefaultPrefabPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % WS_PER_ROW;
    const row = Math.floor(i / WS_PER_ROW);
    placements.push({
      prefabId: 'workstation-standard',
      position: [col * WS_SPACING_X, WS_START_Y + row * WS_ROW_GAP],
    });
  }
  // A touch of greenery
  placements.push({
    prefabId: 'plant-small',
    position: [0, -20],
  });
  return placements;
}

function libraryLayout(): DefaultPrefabPlacement[] {
  return [
    { prefabId: 'bookshelf-double', position: [-40, -30] },
    { prefabId: 'bookshelf-double', position: [40, -30] },
    { prefabId: 'reading-table', position: [0, 20] },
    { prefabId: 'chair-standalone', position: [0, 40] },
    { prefabId: 'plant-large', position: [-60, 30] },
  ];
}

function restAreaLayout(): DefaultPrefabPlacement[] {
  return [
    { prefabId: 'sofa-set', position: [0, -10] },
    { prefabId: 'coffee-table', position: [50, 0] },
    { prefabId: 'vending-machine', position: [-50, -10] },
    { prefabId: 'plant-small', position: [60, -30] },
  ];
}

function meetingRoomLayout(count: number): DefaultPrefabPlacement[] {
  const placements: DefaultPrefabPlacement[] = [];
  if (count <= 4) {
    placements.push({ prefabId: 'meeting-table-4', position: [0, 0] });
  } else {
    placements.push({ prefabId: 'meeting-table-8', position: [0, 0] });
  }
  placements.push({ prefabId: 'whiteboard', position: [0, -50] });
  return placements;
}

/** Horizontal spacing between server racks. */
const RACK_SPACING = 26;

function serverRoomLayout(count: number): DefaultPrefabPlacement[] {
  const n = Math.max(1, count);
  const placements: DefaultPrefabPlacement[] = [];
  for (let i = 0; i < n; i++) {
    placements.push({
      prefabId: 'server-rack-2u',
      position: [i * RACK_SPACING, 0],
    });
  }
  placements.push({
    prefabId: 'cable-tray',
    position: [((n - 1) * RACK_SPACING) / 2, 30],
  });
  placements.push({
    prefabId: 'network-switch',
    position: [0, -30],
  });
  return placements;
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
      return departmentLayout(count ?? 3);
    case 'library':
      return libraryLayout();
    case 'rest_area':
      return restAreaLayout();
    case 'meeting_room':
      return meetingRoomLayout(count ?? 4);
    case 'server_room':
      return serverRoomLayout(count ?? 2);
  }
}
