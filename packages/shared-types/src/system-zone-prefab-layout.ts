import type { ZonePresetPrefab } from './zone-presets.js';
import { extractZoneSlug } from './zone-resolution.js';
import type { SystemZoneTemplate, Zone, ZoneArchetype } from './zone.js';

export const SYSTEM_PREFAB_LAYOUT_VERSION = 20260507;

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

const DEV_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-dual', -4.2, -1.6, 0),
  placement('workstation-standard', -1.4, -1.6, 0),
  placement('workstation-standard', 1.4, -1.6, 0),
  placement('workstation-dual', 4.2, -1.6, 0),
  placement('workstation-standard', -2.4, 2.2, 180),
  placement('workstation-standard', 2.4, 2.2, 180),
];

const PRODUCT_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-compact', -3.4, -1.25, 0),
  placement('workstation-standard', -0.9, -1.25, 0),
  placement('workstation-standard', 1.65, -1.25, 0),
  placement('workstation-compact', 3.85, -1.25, 0),
];

const ART_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-dual', -3.4, -1.35, 0),
  placement('workstation-standard', -0.6, -1.35, 0),
  placement('workstation-standard', 2.2, -1.35, 0),
  placement('workstation-dual', -1.2, 2.25, 180),
];

const GENERIC_WORKSTATIONS: readonly ZonePresetPrefab[] = [
  placement('workstation-standard', -3.3, -1.5, 0),
  placement('workstation-standard', 0, -1.5, 0),
  placement('workstation-standard', 3.3, -1.5, 0),
  placement('workstation-standard', -1.65, 2.15, 180),
  placement('workstation-standard', 1.65, 2.15, 180),
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
      placement('standing-table', -3.3, 2.2, 180),
      placement('status-board', 2.75, 2.25, 180),
      placement('plant-small', 4.25, 2.9),
    ];
  }
  if (slug === 'zone-art') {
    return [
      ...ART_WORKSTATIONS.slice(0, targetSeats),
      placement('standing-table', 3.7, 2.05, 180),
      placement('plant-large', -4.3, 2.85),
      placement('plant-small', 4.25, -3),
    ];
  }
  const seats = slug === 'zone-dev' ? DEV_WORKSTATIONS : GENERIC_WORKSTATIONS;
  return [
    ...seats.slice(0, targetSeats),
    placement('water-cooler', -5.25, 2.9, 90),
    placement('plant-large', 5.3, 2.85),
  ];
}

function utilityLayout(archetype: ZoneArchetype | null): readonly ZonePresetPrefab[] {
  switch (archetype) {
    case 'library':
      return [
        placement('bookshelf-double', -4.7, -3.05, 0),
        placement('bookshelf-double', 0, -3.05, 0),
        placement('bookshelf-single', 4.55, -3.05, 0),
        placement('reading-table', -2.5, 0.65, 0),
        placement('chair-standalone', -2.5, 2.0, 0),
        placement('reading-table', 2.4, 0.65, 0),
        placement('chair-standalone', 2.4, 2.0, 0),
        placement('plant-large', 5.4, 2.65),
      ];
    case 'rest':
      return [
        placement('sofa-set', -2.5, -0.95, 0),
        placement('coffee-table', 1.15, -0.95, 0),
        placement('vending-machine', 5.0, -2.65, 180),
        placement('water-cooler', 5.1, 1.0, 180),
        placement('plant-large', -5.2, -2.75),
        placement('plant-small', 4.8, 2.8),
      ];
    case 'meeting':
      return [
        placement('meeting-table-8', 0, 0.45, 0),
        placement('whiteboard', 0, -2.65, 0),
        placement('plant-small', -5.3, -2.2),
        placement('plant-small', 5.3, -2.2),
      ];
    case 'server':
      return [
        placement('server-rack-4u', -4.35, -0.35, 0),
        placement('server-rack-2u', -1.45, -0.35, 0),
        placement('server-rack-2u', 1.45, -0.35, 0),
        placement('server-rack-4u', 4.35, -0.35, 0),
        placement('cable-tray', 0, 2.25, 90),
        placement('network-switch', -4.75, 2.55, 0),
        placement('patch-panel', 4.45, 2.55, 0),
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
