// ── Zone Presets ────────────────────────────────────────────────────
// Pre-configured zone templates with furniture layouts.
// Used by the Office Editor to let users place fully-furnished zones.
// Prefab offsets are relative to zone center in world coordinates.

import type { SemanticCategory } from './prefab.js';
import type { RoleSlug } from './roles.js';
import type { ActivityType, ZoneArchetype } from './zone.js';

// ── Types ──────────────────────────────────────────────────────────

export interface ZonePresetPrefab {
  readonly prefabId: string;
  readonly offsetX: number; // relative to zone center (world units)
  readonly offsetZ: number; // relative to zone center (world units)
  readonly rotation?: 0 | 90 | 180 | 270;
}

export interface ZonePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly archetype: ZoneArchetype;
  readonly accentColor: string;
  readonly floorColor: number;
  readonly w: number;
  readonly d: number;
  readonly deskSlots: number;
  readonly targetRoles: readonly RoleSlug[];
  readonly allowedCategories: readonly SemanticCategory[];
  readonly activityTypes: readonly ActivityType[];
  readonly prefabs: readonly ZonePresetPrefab[];
}

// ── Workspace Presets ──────────────────────────────────────────────

const SMALL_OFFICE: ZonePreset = {
  id: 'preset-small-office',
  label: 'Small Office',
  description: '2 desks, cozy workspace',
  icon: '🏠',
  archetype: 'workspace',
  accentColor: '#3b82f6',
  floorColor: 0x2a3a5c,
  w: 8,
  d: 6,
  deskSlots: 2,
  targetRoles: ['developer', 'engineer', 'designer'],
  allowedCategories: ['workspace', 'infrastructure', 'decorative'],
  activityTypes: ['work'],
  prefabs: [
    { prefabId: 'workstation-standard', offsetX: -2, offsetZ: 0 },
    { prefabId: 'workstation-standard', offsetX: 2, offsetZ: 0 },
    { prefabId: 'plant-small', offsetX: -3.5, offsetZ: -2.5 },
  ],
};

const TEAM_OFFICE: ZonePreset = {
  id: 'preset-team-office',
  label: 'Team Office',
  description: '4 desks, team workspace',
  icon: '👥',
  archetype: 'workspace',
  accentColor: '#6366f1',
  floorColor: 0x2a3050,
  w: 14,
  d: 10,
  deskSlots: 4,
  targetRoles: ['developer', 'engineer', 'backend', 'frontend', 'fullstack'],
  allowedCategories: ['workspace', 'infrastructure', 'decorative'],
  activityTypes: ['work'],
  prefabs: [
    { prefabId: 'workstation-standard', offsetX: -3.5, offsetZ: -2 },
    { prefabId: 'workstation-standard', offsetX: 0.5, offsetZ: -2 },
    { prefabId: 'workstation-standard', offsetX: -3.5, offsetZ: 2 },
    { prefabId: 'workstation-standard', offsetX: 0.5, offsetZ: 2 },
    { prefabId: 'filing-cabinet', offsetX: 5, offsetZ: -4 },
    { prefabId: 'plant-small', offsetX: -6, offsetZ: -4.5 },
    { prefabId: 'plant-small', offsetX: 6, offsetZ: 4 },
  ],
};

const LARGE_OFFICE: ZonePreset = {
  id: 'preset-large-office',
  label: 'Large Office',
  description: '6 desks, open plan',
  icon: '🏢',
  archetype: 'workspace',
  accentColor: '#8b5cf6',
  floorColor: 0x302a50,
  w: 18,
  d: 12,
  deskSlots: 6,
  targetRoles: ['developer', 'engineer', 'pm', 'analyst', 'designer'],
  allowedCategories: ['workspace', 'infrastructure', 'decorative'],
  activityTypes: ['work'],
  prefabs: [
    // Row 1 (4.5 units apart)
    { prefabId: 'workstation-standard', offsetX: -4.5, offsetZ: -2.5 },
    { prefabId: 'workstation-standard', offsetX: 0, offsetZ: -2.5 },
    { prefabId: 'workstation-standard', offsetX: 4.5, offsetZ: -2.5 },
    // Row 2
    { prefabId: 'workstation-standard', offsetX: -4.5, offsetZ: 2.5 },
    { prefabId: 'workstation-standard', offsetX: 0, offsetZ: 2.5 },
    { prefabId: 'workstation-standard', offsetX: 4.5, offsetZ: 2.5 },
    // Amenities
    { prefabId: 'standing-table', offsetX: 8, offsetZ: 0 },
    { prefabId: 'water-cooler', offsetX: -8, offsetZ: -5 },
    { prefabId: 'plant-large', offsetX: -8, offsetZ: 5 },
    { prefabId: 'plant-small', offsetX: 8, offsetZ: 5 },
  ],
};

// ── Meeting Presets ────────────────────────────────────────────────

const HUDDLE_ROOM: ZonePreset = {
  id: 'preset-huddle-room',
  label: 'Huddle Room',
  description: '4-seat quick meeting',
  icon: '💬',
  archetype: 'meeting',
  accentColor: '#94a3b8',
  floorColor: 0x3a4a5c,
  w: 7,
  d: 6,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['collaboration', 'decorative'],
  activityTypes: ['meet', 'collaborate'],
  prefabs: [
    { prefabId: 'meeting-table-4', offsetX: 0, offsetZ: 0.5 },
    { prefabId: 'whiteboard', offsetX: 0, offsetZ: -2.5 },
  ],
};

const CONFERENCE_ROOM: ZonePreset = {
  id: 'preset-conference-room',
  label: 'Conference Room',
  description: '8-seat meeting room',
  icon: '📋',
  archetype: 'meeting',
  accentColor: '#64748b',
  floorColor: 0x354050,
  w: 10,
  d: 8,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['collaboration', 'decorative'],
  activityTypes: ['meet', 'collaborate'],
  prefabs: [
    { prefabId: 'meeting-table-8', offsetX: 0, offsetZ: 0 },
    { prefabId: 'whiteboard', offsetX: 0, offsetZ: -3 },
    { prefabId: 'plant-small', offsetX: -4, offsetZ: -3.5 },
    { prefabId: 'plant-small', offsetX: 4, offsetZ: -3.5 },
  ],
};

// ── Library Presets ────────────────────────────────────────────────

const READING_CORNER: ZonePreset = {
  id: 'preset-reading-corner',
  label: 'Reading Corner',
  description: 'Cozy reading space',
  icon: '📖',
  archetype: 'library',
  accentColor: '#10b981',
  floorColor: 0x2a5c3a,
  w: 8,
  d: 6,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['knowledge', 'workspace', 'decorative'],
  activityTypes: ['learn'],
  prefabs: [
    { prefabId: 'bookshelf-single', offsetX: -3, offsetZ: -2 },
    { prefabId: 'reading-table', offsetX: 0, offsetZ: 0 },
    { prefabId: 'chair-standalone', offsetX: 0, offsetZ: 1.5 },
    { prefabId: 'plant-large', offsetX: 3, offsetZ: -2 },
  ],
};

const FULL_LIBRARY: ZonePreset = {
  id: 'preset-full-library',
  label: 'Full Library',
  description: 'Bookshelves & reading area',
  icon: '📚',
  archetype: 'library',
  accentColor: '#059669',
  floorColor: 0x1f4a30,
  w: 14,
  d: 8,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['knowledge', 'workspace', 'decorative'],
  activityTypes: ['learn'],
  prefabs: [
    { prefabId: 'bookshelf-double', offsetX: -4, offsetZ: -3 },
    { prefabId: 'bookshelf-double', offsetX: 4, offsetZ: -3 },
    { prefabId: 'reading-table', offsetX: -1.5, offsetZ: 1 },
    { prefabId: 'reading-table', offsetX: 1.5, offsetZ: 1 },
    { prefabId: 'chair-standalone', offsetX: -1.5, offsetZ: 2.5 },
    { prefabId: 'chair-standalone', offsetX: 1.5, offsetZ: 2.5 },
    { prefabId: 'filing-cabinet', offsetX: -6, offsetZ: 3 },
    { prefabId: 'plant-large', offsetX: 6, offsetZ: 3 },
  ],
};

// ── Rest Area Presets ──────────────────────────────────────────────

const BREAK_CORNER: ZonePreset = {
  id: 'preset-break-corner',
  label: 'Break Corner',
  description: 'Quick break area',
  icon: '☕',
  archetype: 'rest',
  accentColor: '#f59e0b',
  floorColor: 0x4a4a3a,
  w: 8,
  d: 6,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['decorative'],
  activityTypes: ['rest'],
  prefabs: [
    { prefabId: 'sofa-set', offsetX: -1, offsetZ: -0.5 },
    { prefabId: 'vending-machine', offsetX: -3, offsetZ: -2 },
    { prefabId: 'plant-small', offsetX: 3.5, offsetZ: -2.5 },
  ],
};

const LOUNGE: ZonePreset = {
  id: 'preset-lounge',
  label: 'Lounge',
  description: 'Spacious rest & social area',
  icon: '🛋️',
  archetype: 'rest',
  accentColor: '#d97706',
  floorColor: 0x3d3d2e,
  w: 12,
  d: 8,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['decorative'],
  activityTypes: ['rest'],
  prefabs: [
    { prefabId: 'sofa-set', offsetX: -2, offsetZ: -1 },
    { prefabId: 'vending-machine', offsetX: 4, offsetZ: -3 },
    { prefabId: 'water-cooler', offsetX: 4, offsetZ: 1 },
    { prefabId: 'plant-large', offsetX: -5, offsetZ: -3 },
    { prefabId: 'plant-small', offsetX: 5, offsetZ: 3 },
  ],
};

// ── Server Presets ─────────────────────────────────────────────────

const SERVER_CLOSET: ZonePreset = {
  id: 'preset-server-closet',
  label: 'Server Closet',
  description: '2 racks, compact',
  icon: '🔌',
  archetype: 'server',
  accentColor: '#06b6d4',
  floorColor: 0x1e2433,
  w: 6,
  d: 5,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['compute', 'infrastructure'],
  activityTypes: ['compute'],
  prefabs: [
    { prefabId: 'server-rack-2u', offsetX: -1.5, offsetZ: 0 },
    { prefabId: 'server-rack-2u', offsetX: 1.5, offsetZ: 0 },
    { prefabId: 'network-switch', offsetX: 0, offsetZ: -2 },
  ],
};

const SERVER_ROOM: ZonePreset = {
  id: 'preset-server-room',
  label: 'Server Room',
  description: '4 racks, full infrastructure',
  icon: '🖥️',
  archetype: 'server',
  accentColor: '#0891b2',
  floorColor: 0x171d2a,
  w: 14,
  d: 6,
  deskSlots: 0,
  targetRoles: [],
  allowedCategories: ['compute', 'infrastructure'],
  activityTypes: ['compute'],
  prefabs: [
    { prefabId: 'server-rack-2u', offsetX: -4.5, offsetZ: 0 },
    { prefabId: 'server-rack-2u', offsetX: -1.5, offsetZ: 0 },
    { prefabId: 'server-rack-2u', offsetX: 1.5, offsetZ: 0 },
    { prefabId: 'server-rack-2u', offsetX: 4.5, offsetZ: 0 },
    { prefabId: 'cable-tray', offsetX: 0, offsetZ: -2.5 },
    { prefabId: 'network-switch', offsetX: -5.5, offsetZ: -2.5 },
    { prefabId: 'patch-panel', offsetX: 5, offsetZ: -2.5 },
  ],
};

// ── Public Catalog ─────────────────────────────────────────────────

/** Group presets by archetype for palette display. */
export const ZONE_PRESET_GROUPS: readonly {
  archetype: ZoneArchetype;
  label: string;
  icon: string;
  presets: readonly ZonePreset[];
}[] = [
  {
    archetype: 'workspace',
    label: 'Workspace',
    icon: '💼',
    presets: [SMALL_OFFICE, TEAM_OFFICE, LARGE_OFFICE],
  },
  {
    archetype: 'meeting',
    label: 'Meeting',
    icon: '🤝',
    presets: [HUDDLE_ROOM, CONFERENCE_ROOM],
  },
  {
    archetype: 'library',
    label: 'Library',
    icon: '📚',
    presets: [READING_CORNER, FULL_LIBRARY],
  },
  {
    archetype: 'rest',
    label: 'Rest Area',
    icon: '☕',
    presets: [BREAK_CORNER, LOUNGE],
  },
  {
    archetype: 'server',
    label: 'Server',
    icon: '🖥️',
    presets: [SERVER_CLOSET, SERVER_ROOM],
  },
];

/** Flat list of all presets, derived from the grouped catalog. */
export const ZONE_PRESETS: readonly ZonePreset[] = ZONE_PRESET_GROUPS.flatMap((g) => g.presets);

/** Look up a preset by ID. */
export function findZonePreset(id: string): ZonePreset | undefined {
  return ZONE_PRESETS.find((p) => p.id === id);
}

// ── Required Zone Archetypes ───────────────────────────────────────
// These archetypes are functionally required for the game loop:
// - rest: employees start/idle here, ceremony dismiss target
// - meeting: ceremony gathering point, requirement discussions

export const REQUIRED_ARCHETYPES: readonly ZoneArchetype[] = ['rest', 'meeting'] as const;

export function isRequiredArchetype(archetype: ZoneArchetype | null): boolean {
  return archetype !== null && (REQUIRED_ARCHETYPES as readonly string[]).includes(archetype);
}

/** Get presets for a given archetype (for variant swapping). */
export function getPresetsForArchetype(archetype: ZoneArchetype): readonly ZonePreset[] {
  return ZONE_PRESET_GROUPS.find((g) => g.archetype === archetype)?.presets ?? [];
}
