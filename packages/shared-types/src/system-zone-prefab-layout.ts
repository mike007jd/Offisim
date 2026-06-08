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
  placement('workstation-dual', -4.6, -1.9, 0),
  placement('workstation-standard', -1.45, -1.9, 0),
  placement('workstation-standard', 1.75, -1.9, 0),
  placement('workstation-dual', 4.9, -1.9, 0),
  placement('workstation-standard', -2.25, 2.7, 180),
  placement('workstation-standard', 2.45, 2.7, 180),
];

const PRODUCT_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-standard', -3.7, -1.35, 0),
  placement('workstation-standard', -0.7, -1.35, 0),
  placement('workstation-standard', 2.3, -1.35, 0),
  placement('workstation-compact', 4.9, 2.2, 180),
];

const ART_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-dual', -4.1, -1.45, 0),
  placement('workstation-standard', -0.9, -1.45, 0),
  placement('workstation-standard', 2.4, -1.45, 0),
  placement('workstation-dual', -1.1, 2.7, 180),
];

const GENERIC_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-standard', -4.0, -1.75, 0),
  placement('workstation-standard', -0.5, -1.75, 0),
  placement('workstation-standard', 3.0, -1.75, 0),
  placement('workstation-standard', -2.1, 2.6, 180),
  placement('workstation-standard', 2.4, 2.6, 180),
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
      placement('standing-table', -2.6, 2.7, 180),
      placement('status-board', 4.6, -2.8, 180),
      placement('plant-large', 5.0, 2.9),
    ];
  }
  if (slug === 'zone-art') {
    return [
      ...ART_WORKSTATIONS.slice(0, targetSeats),
      placement('standing-table', 3.8, 2.8, 180),
      placement('status-board', 4.7, -2.8, 180),
      placement('plant-large', -4.8, 2.9),
      placement('plant-small', 4.7, -3.1),
    ];
  }
  const seats = slug === 'zone-dev' ? DEV_WORKSTATIONS : GENERIC_WORKSTATIONS;
  return [
    ...seats.slice(0, targetSeats),
    placement('standing-table', -5.1, 2.9, 180),
    placement('network-switch', 5.3, 2.8, 0),
    placement('plant-large', 5.5, -3.0),
  ];
}

function utilityLayout(archetype: ZoneArchetype | null): readonly ZonePresetPrefab[] {
  switch (archetype) {
    case 'library':
      return [
        placement('bookshelf-double', -4.9, -2.85, 0),
        placement('bookshelf-double', 4.9, -2.85, 0),
        placement('reading-table', 0, 0.65, 0),
        placement('chair-standalone', -1.05, 2.45, 0),
        placement('chair-standalone', 1.05, 2.45, 0),
        placement('plant-large', 5.6, 2.65),
      ];
    case 'rest':
      return [
        placement('sofa-set', -2.8, -0.75, 0),
        placement('coffee-table', 1.45, -0.75, 0),
        placement('water-cooler', 5.15, -2.75, 180),
        placement('vending-machine', 4.85, 2.3, 180),
        placement('plant-large', -5.5, -2.85),
      ];
    case 'meeting':
      return [
        placement('meeting-table-8', 0, 0.5, 0),
        placement('whiteboard', 0, -2.9, 0),
        placement('status-board', 5.45, 2.45, 180),
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
