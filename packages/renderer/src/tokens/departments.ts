// ── Department & zone configuration ────────────────────────────────
// Maps role_slug → department, defines zone layout for the office floor.

export interface DepartmentConfig {
  readonly id: string;
  readonly label: string;
  readonly labelEn: string;
  readonly roleSlugs: readonly string[];
  readonly floorColor: number;
  readonly accentColor: number;
}

export type ZoneType = 'department' | 'library' | 'rest_area' | 'meeting_room' | 'server_room';

export interface ZoneConfig {
  readonly zoneId: string;
  readonly type: ZoneType;
  readonly department?: DepartmentConfig;
  readonly label: string;
  readonly labelEn: string;
  readonly floorColor: number;
  /** Minimum workstation slots even when empty */
  readonly minSlots: number;
}

// ── R&D Company departments ─────────────────────────────────────────

export const RD_COMPANY_DEPARTMENTS: readonly DepartmentConfig[] = [
  {
    id: 'dev',
    label: '开发部门',
    labelEn: 'DEV',
    roleSlugs: ['developer', 'engineer', 'backend', 'frontend', 'fullstack', 'writer'],
    floorColor: 0x2a3a5c,
    accentColor: 0x3978a8,
  },
  {
    id: 'product',
    label: '产品部门',
    labelEn: 'PROD',
    roleSlugs: ['pm', 'product_manager', 'researcher', 'analyst', 'manager', 'seo_specialist', 'project_manager', 'account_manager', 'qa'],
    floorColor: 0x3a2a5c,
    accentColor: 0xa78bfa,
  },
  {
    id: 'art',
    label: '美术部门',
    labelEn: 'ART',
    roleSlugs: ['designer', 'artist', 'ui_designer', 'ux_designer', 'graphic_designer'],
    floorColor: 0x6b4530,
    accentColor: 0xf77622,
  },
] as const;

// ── Zone definitions ────────────────────────────────────────────────

export const RD_COMPANY_ZONES: readonly ZoneConfig[] = [
  ...RD_COMPANY_DEPARTMENTS.map((d) => ({
    zoneId: `zone-${d.id}`,
    type: 'department' as const,
    department: d,
    label: d.label,
    labelEn: d.labelEn,
    floorColor: d.floorColor,
    minSlots: 2,
  })),
  {
    zoneId: 'zone-library',
    type: 'library',
    label: '图书馆',
    labelEn: 'LIB',
    floorColor: 0x2a5c3a,
    minSlots: 0,
  },
  {
    zoneId: 'zone-rest',
    type: 'rest_area',
    label: '休息区',
    labelEn: 'REST',
    floorColor: 0x4a4a3a,
    minSlots: 0,
  },
  {
    zoneId: 'zone-meeting',
    type: 'meeting_room',
    label: '会议室',
    labelEn: 'MTG',
    floorColor: 0x3a4a5c,
    minSlots: 0,
  },
  {
    zoneId: 'zone-server',
    type: 'server_room',
    label: '机房',
    labelEn: 'SRV',
    floorColor: 0x1e2433,
    minSlots: 0,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────

const _roleToDeptMap = new Map<string, string>();
for (const dept of RD_COMPANY_DEPARTMENTS) {
  for (const slug of dept.roleSlugs) {
    _roleToDeptMap.set(slug, dept.id);
  }
}

/**
 * Resolve a role_slug to its department ID.
 * Returns `null` if the role doesn't belong to any known department.
 */
export function resolveEmployeeDepartment(roleSlug: string): string | null {
  return _roleToDeptMap.get(roleSlug) ?? null;
}
