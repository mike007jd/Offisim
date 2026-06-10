import type { ZonePresetPrefab } from './zone-presets.js';
import { extractZoneSlug } from './zone-resolution.js';
import type { SystemZoneTemplate, Zone, ZoneArchetype } from './zone.js';

export const SYSTEM_PREFAB_LAYOUT_VERSION = 2026061001;

export interface SystemZonePrefabLayoutInput {
  readonly slug?: string;
  readonly zoneId?: string;
  readonly archetype: ZoneArchetype | null;
  readonly deskSlots?: number;
}

function placement(
  prefabId: string,
  offsetX: number,
  offsetZ: number,
  rotation?: 0 | 90 | 180 | 270,
): ZonePresetPrefab {
  return { prefabId, offsetX, offsetZ, ...(rotation !== undefined ? { rotation } : {}) };
}

// Workstation rows are spaced wider than the raw desk footprint so the 3D
// scene's content scale (SCENE_CONTENT_SCALE) can enlarge each desk without the
// neighbours touching. Fewer trailing decorations per zone — "大而精致" over
// many small props.
const DEV_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-dual', -3.8, -1.35, 0),
  placement('workstation-standard', 2.75, 1.55, 180),
];

const PRODUCT_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-standard', -3.25, -1.25, 0),
  placement('workstation-standard', 2.65, 1.65, 180),
];

const ART_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-dual', -3.2, -1.25, 0),
  placement('workstation-standard', 2.85, 1.65, 180),
];

const GENERIC_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-standard', -3.1, -1.25, 0),
  placement('workstation-standard', 2.55, 1.55, 180),
];

function workspaceLayout(
  slug: string,
  deskSlots: number,
  occupiedSeats: number | undefined,
): readonly ZonePresetPrefab[] {
  const maxWorkstations = 2;
  const targetWorkstations = Math.max(
    1,
    Math.min(Math.max(occupiedSeats ?? 0, deskSlots, 1), maxWorkstations),
  );
  if (slug === 'zone-product') {
    return [
      ...PRODUCT_WORKSTATIONS.slice(0, targetWorkstations),
      placement('standing-table', 0, 2.8, 180),
      // Wall-adjacent boards face the zone interior (rotation 0 = +z).
      placement('status-board', 4.8, -2.85, 0),
      placement('plant-large', -5.05, 2.75),
    ];
  }
  if (slug === 'zone-art') {
    return [
      ...ART_WORKSTATIONS.slice(0, targetWorkstations),
      placement('standing-table', -0.1, 2.75, 180),
      placement('status-board', 4.8, -2.85, 0),
      placement('plant-large', -5.05, 2.65),
    ];
  }
  const seats = slug === 'zone-dev' ? DEV_WORKSTATIONS : GENERIC_WORKSTATIONS;
  return [
    ...seats.slice(0, targetWorkstations),
    placement('standing-table', -0.9, 2.85, 180),
    placement('network-switch', 5.15, -2.85, 0),
    placement('plant-large', -5.35, 2.9),
  ];
}

function utilityLayout(archetype: ZoneArchetype | null): readonly ZonePresetPrefab[] {
  switch (archetype) {
    case 'library':
      return [
        placement('bookshelf-double', -5.4, -2.55, 0),
        placement('bookshelf-double', 5.4, -2.55, 0),
        placement('reading-table', 0, 1.45, 0),
        placement('chair-standalone', -2.4, 2.85, 0),
        placement('chair-standalone', 2.4, 2.85, 0),
        placement('plant-large', -5.4, 2.7),
      ];
    case 'rest':
      return [
        placement('sofa-set', -2.8, -0.75, 0),
        // Coffee table nests in the sofa's L-opening.
        placement('coffee-table', -1.05, 0.55, 0),
        placement('water-cooler', 5.15, -2.75, 0),
        placement('plant-large', -5.45, -2.85),
      ];
    case 'meeting':
      return [
        placement('meeting-table-8', 0, 0.5, 0),
        placement('whiteboard', 0, -2.9, 0),
        placement('status-board', 5.45, 2.45, 270),
        placement('plant-large', -5.45, 2.45),
      ];
    case 'server':
      return [
        placement('server-rack-4u', -4.2, -0.4, 0),
        placement('server-rack-2u', 0, -0.4, 0),
        placement('server-rack-4u', 4.2, -0.4, 0),
        placement('cable-tray', -2.2, 2.65, 0),
        placement('network-switch', 2.2, 2.65, 0),
      ];
    default:
      return [];
  }
}

export function getSystemZoneDefaultPrefabs(
  zone: SystemZoneTemplate | Zone | SystemZonePrefabLayoutInput,
  options: { occupiedSeats?: number } = {},
): readonly ZonePresetPrefab[] {
  const slug =
    'slug' in zone && zone.slug
      ? zone.slug
      : 'zoneId' in zone && zone.zoneId
        ? extractZoneSlug(zone.zoneId)
        : '';
  if (zone.archetype === 'workspace') {
    return workspaceLayout(slug, zone.deskSlots ?? 4, options.occupiedSeats);
  }
  return utilityLayout(zone.archetype);
}
