import type { ZonePresetPrefab } from './zone-presets.js';
import { extractZoneSlug } from './zone-resolution.js';
import type { SystemZoneTemplate, Zone, ZoneArchetype } from './zone.js';

export const SYSTEM_PREFAB_LAYOUT_VERSION = 20260608;

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
  placement('workstation-dual', -4.8, -1.85, 0),
  placement('workstation-standard', -1.6, -1.85, 0),
  placement('workstation-standard', 1.6, -1.85, 0),
  placement('workstation-dual', 4.8, -1.85, 0),
  placement('workstation-standard', -2.7, 2.55, 180),
  placement('workstation-standard', 2.7, 2.55, 180),
];

const PRODUCT_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-compact', -4.0, -1.45, 0),
  placement('workstation-standard', -1.1, -1.45, 0),
  placement('workstation-standard', 1.9, -1.45, 0),
  placement('workstation-compact', 4.5, -1.45, 0),
];

const ART_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-dual', -3.9, -1.5, 0),
  placement('workstation-standard', -0.7, -1.5, 0),
  placement('workstation-standard', 2.5, -1.5, 0),
  placement('workstation-dual', -1.4, 2.6, 180),
];

const GENERIC_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-standard', -3.8, -1.7, 0),
  placement('workstation-standard', 0, -1.7, 0),
  placement('workstation-standard', 3.8, -1.7, 0),
  placement('workstation-standard', -1.9, 2.55, 180),
  placement('workstation-standard', 1.9, 2.55, 180),
];

function workspaceLayout(
  slug: string,
  deskSlots: number,
  occupiedSeats: number | undefined,
): readonly ZonePresetPrefab[] {
  const targetSeats = Math.max(1, Math.min(Math.max(occupiedSeats ?? 0, deskSlots, 1), 6));
  if (slug === 'zone-product') {
    return [
      ...PRODUCT_WORKSTATIONS.slice(0, targetSeats),
      placement('standing-table', -3.6, 2.6, 180),
      placement('plant-large', 5.0, 2.9),
    ];
  }
  if (slug === 'zone-art') {
    return [
      ...ART_WORKSTATIONS.slice(0, targetSeats),
      placement('plant-large', -4.7, 2.9),
      placement('plant-small', 4.7, -3.1),
    ];
  }
  const seats = slug === 'zone-dev' ? DEV_WORKSTATIONS : GENERIC_WORKSTATIONS;
  return [...seats.slice(0, targetSeats), placement('plant-large', 5.4, 2.9)];
}

function utilityLayout(archetype: ZoneArchetype | null): readonly ZonePresetPrefab[] {
  switch (archetype) {
    case 'library':
      return [
        placement('bookshelf-double', -3.8, -3.15, 0),
        placement('bookshelf-double', 3.8, -3.15, 0),
        placement('reading-table', 0, 0.8, 0),
        placement('chair-standalone', 0, 2.4, 0),
        placement('plant-large', 5.4, 2.7),
      ];
    case 'rest':
      return [
        placement('sofa-set', -2.4, -0.9, 0),
        placement('coffee-table', 1.5, -0.9, 0),
        placement('vending-machine', 5.2, -2.8, 180),
        placement('plant-large', -5.3, -2.85),
      ];
    case 'meeting':
      return [
        placement('meeting-table-8', 0, 0.5, 0),
        placement('whiteboard', 0, -2.9, 0),
        placement('plant-large', 5.4, 2.6),
      ];
    case 'server':
      return [
        placement('server-rack-4u', -3.4, -0.4, 0),
        placement('server-rack-2u', 0, -0.4, 0),
        placement('server-rack-4u', 3.4, -0.4, 0),
        placement('network-switch', 5.1, 2.6, 0),
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
