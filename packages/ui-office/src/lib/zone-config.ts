/** Shared zone configuration — single source of truth for 2D, 3D, and editor views. */

/** Human-readable space type label shown in the Office Editor UI. */
export type ZoneSpaceType =
  | 'Work Zone'
  | 'Knowledge Zone'
  | 'Break Zone'
  | 'Meeting Zone'
  | 'Infrastructure Zone';

export interface ZoneDef {
  readonly id: string;
  readonly label: string;
  readonly accent: string;
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
  readonly type: 'dept' | 'support' | 'infra';
  readonly roleSlugs: readonly string[];
  readonly deskSlots: number;
  /** Space type label shown in the Office Editor UI. */
  readonly spaceType: ZoneSpaceType;
}

export const ZONES: readonly ZoneDef[] = [
  {
    id: 'mtg',
    label: 'MEETING ROOM',
    accent: '#94a3b8',
    cx: -10,
    cz: -8,
    w: 14,
    d: 6,
    type: 'infra',
    roleSlugs: [],
    deskSlots: 0,
    spaceType: 'Meeting Zone',
  },
  {
    id: 'srv',
    label: 'SERVER ROOM',
    accent: '#06b6d4',
    cx: 8,
    cz: -8,
    w: 14,
    d: 6,
    type: 'infra',
    roleSlugs: [],
    deskSlots: 0,
    spaceType: 'Infrastructure Zone',
  },
  {
    id: 'lib',
    label: 'LIBRARY',
    accent: '#10b981',
    cx: -10,
    cz: 2,
    w: 14,
    d: 8,
    type: 'support',
    roleSlugs: [],
    deskSlots: 0,
    spaceType: 'Knowledge Zone',
  },
  {
    id: 'rest',
    label: 'REST AREA',
    accent: '#f59e0b',
    cx: 8,
    cz: 2,
    w: 14,
    d: 8,
    type: 'support',
    roleSlugs: [],
    deskSlots: 0,
    spaceType: 'Break Zone',
  },
  {
    id: 'dev',
    label: 'DEVELOPMENT',
    accent: '#3b82f6',
    cx: -13,
    cz: 11,
    w: 12,
    d: 8,
    type: 'dept',
    roleSlugs: ['developer', 'engineer', 'backend', 'frontend', 'fullstack', 'writer'],
    deskSlots: 4,
    spaceType: 'Work Zone',
  },
  {
    id: 'prod',
    label: 'PRODUCT',
    accent: '#a855f7',
    cx: 0,
    cz: 11,
    w: 10,
    d: 8,
    type: 'dept',
    roleSlugs: [
      'pm',
      'product_manager',
      'researcher',
      'analyst',
      'manager',
      'seo_specialist',
      'project_manager',
      'account_manager',
      'qa',
    ],
    deskSlots: 4,
    spaceType: 'Work Zone',
  },
  {
    id: 'art',
    label: 'ART & DESIGN',
    accent: '#f97316',
    cx: 12,
    cz: 11,
    w: 10,
    d: 8,
    type: 'dept',
    roleSlugs: ['designer', 'artist', 'ui_designer', 'ux_designer', 'graphic_designer'],
    deskSlots: 4,
    spaceType: 'Work Zone',
  },
];

/** Resolve employee role slug to zone ID. Defaults to 'dev'. */
export function resolveZone(role: string): string {
  for (const z of ZONES) {
    if (z.roleSlugs.includes(role)) return z.id;
  }
  return 'dev';
}

/** Valid zone IDs that accept employees (have desk slots). */
export const VALID_ZONE_IDS: ReadonlySet<string> = new Set(
  ZONES.filter((z) => z.deskSlots > 0).map((z) => z.id),
);

/** Zones that accept employee drops (those with desk slots). */
export const DROP_TARGET_ZONES: readonly ZoneDef[] = ZONES.filter((z) => z.deskSlots > 0);

/**
 * Agent shape that resolveEmployeeZone depends on.
 * Matches AgentState from use-agent-states — kept minimal to avoid circular imports.
 */
export interface AgentZoneInfo {
  role: string;
  workstationId?: string | null;
}

/**
 * Resolve which zone an employee belongs to.
 * Priority: persisted workstationId (from DB, updated by drag-to-assign) → role-based fallback.
 */
export function resolveEmployeeZone(agent: AgentZoneInfo): string {
  if (agent.workstationId && VALID_ZONE_IDS.has(agent.workstationId)) {
    return agent.workstationId;
  }
  return resolveZone(agent.role);
}

/** Status colors for employee states (CSS hex strings). */
export const STATUS_COLORS: Record<string, string> = {
  idle: '#64748b',
  assigned: '#3b82f6',
  thinking: '#818cf8',
  searching: '#c084fc',
  executing: '#10b981',
  meeting: '#a855f7',
  blocked: '#ef4444',
  waiting: '#f59e0b',
  reporting: '#06b6d4',
  success: '#22c55e',
  failed: '#ef4444',
  paused: '#475569',
};

/** Workstation seat positions relative to zone center [x, y, z]. */
export const SEAT_OFFSETS: readonly [number, number, number][] = [
  [-0.8, 0, -1.6],
  [0.8, 0, -1.6],
  [-0.8, 0, 1.6],
  [0.8, 0, 1.6],
];

/** Get the 3D world center of a zone by ID. Returns rest zone if not found. */
export function getZoneCenter3D(zoneId: string): [number, number, number] {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) {
    const rest = ZONES.find((z) => z.id === 'rest');
    if (!rest) {
      throw new Error('Rest zone is missing from zone config');
    }
    return [rest.cx, 0, rest.cz];
  }
  return [zone.cx, 0, zone.cz];
}
