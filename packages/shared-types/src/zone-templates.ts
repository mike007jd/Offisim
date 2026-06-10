// ── System Zone Templates ──────────────────────────────────────────
// Single source of truth for the 7 default zones seeded per company.
// Shared system zone templates consumed by renderer/domain code.
// All consumers should derive from SYSTEM_ZONE_TEMPLATES instead of maintaining their own mapping.

import { normalizeZoneId } from './zone-resolution.js';
import type { SystemZoneTemplate, Zone } from './zone.js';

export const SYSTEM_ZONE_TEMPLATES: readonly SystemZoneTemplate[] = [
  // ── Department zones (workspace archetype) ─────────────────────
  {
    slug: 'zone-dev',
    archetype: 'workspace',
    label: 'DEVELOPMENT',
    accentColor: '#5d7fa5',
    floorColor: 0x2a3a5c,
    cx: -13.2,
    cz: 10.6,
    w: 12.4,
    d: 8.8,
    targetRoles: [
      'developer',
      'engineer',
      'backend',
      'frontend',
      'fullstack',
      'writer',
      'yolo_master',
    ],
    allowedCategories: ['workspace', 'infrastructure', 'decorative'],
    activityTypes: ['work'],
    deskSlots: 4,
    sortOrder: 0,
  },
  {
    slug: 'zone-product',
    archetype: 'workspace',
    label: 'PRODUCT',
    accentColor: '#7b718f',
    floorColor: 0x3a2a5c,
    cx: -0.2,
    cz: 10.6,
    w: 11.2,
    d: 8.8,
    targetRoles: [
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
    allowedCategories: ['workspace', 'infrastructure', 'decorative'],
    activityTypes: ['work'],
    deskSlots: 4,
    sortOrder: 1,
  },
  {
    slug: 'zone-art',
    archetype: 'workspace',
    label: 'ART & DESIGN',
    accentColor: '#a8795f',
    floorColor: 0x6b4530,
    cx: 12.4,
    cz: 10.6,
    w: 11.2,
    d: 8.8,
    targetRoles: ['designer', 'artist', 'ui_designer', 'ux_designer', 'graphic_designer'],
    allowedCategories: ['workspace', 'infrastructure', 'decorative'],
    activityTypes: ['work'],
    deskSlots: 4,
    sortOrder: 2,
  },

  // ── Utility zones ─────────────────────────────────────────────
  {
    slug: 'zone-library',
    archetype: 'library',
    label: 'LIBRARY',
    accentColor: '#5f8f73',
    floorColor: 0x2a5c3a,
    cx: -11.3,
    cz: 0.7,
    w: 13.2,
    d: 7.6,
    targetRoles: [],
    allowedCategories: ['knowledge', 'workspace', 'decorative'],
    activityTypes: ['learn'],
    deskSlots: 0,
    sortOrder: 3,
  },
  {
    slug: 'zone-rest',
    archetype: 'rest',
    label: 'REST AREA',
    accentColor: '#b08a58',
    floorColor: 0x4a4a3a,
    cx: 6.3,
    cz: 0.7,
    w: 13.8,
    d: 7.6,
    targetRoles: [],
    allowedCategories: ['decorative'],
    activityTypes: ['rest'],
    deskSlots: 0,
    sortOrder: 4,
  },
  {
    slug: 'zone-meeting',
    archetype: 'meeting',
    label: 'MEETING ROOM',
    accentColor: '#94a3b8',
    floorColor: 0x3a4a5c,
    cx: -9.4,
    cz: -8.8,
    w: 15.2,
    d: 7.4,
    targetRoles: [],
    allowedCategories: ['collaboration', 'decorative'],
    activityTypes: ['meet', 'collaborate'],
    deskSlots: 0,
    sortOrder: 5,
  },
  {
    slug: 'zone-server',
    archetype: 'server',
    label: 'SERVER ROOM',
    accentColor: '#4a8b98',
    floorColor: 0x1e2433,
    cx: 9.4,
    cz: -8.8,
    w: 15.2,
    d: 7.4,
    targetRoles: [],
    allowedCategories: ['compute', 'infrastructure'],
    activityTypes: ['compute'],
    deskSlots: 0,
    sortOrder: 6,
  },
] as const;

// ── Archetype defaults (for template zone factory) ──────────────────

type ArchetypeDefaults = Pick<
  SystemZoneTemplate,
  'allowedCategories' | 'activityTypes' | 'deskSlots' | 'accentColor' | 'floorColor'
>;

const ARCHETYPE_DEFAULTS: Readonly<Record<string, ArchetypeDefaults>> = {
  workspace: {
    allowedCategories: ['workspace', 'infrastructure', 'decorative'],
    activityTypes: ['work'],
    deskSlots: 4,
    accentColor: '#5d7fa5',
    floorColor: 0x2a3a5c,
  },
  library: {
    allowedCategories: ['knowledge', 'workspace', 'decorative'],
    activityTypes: ['learn'],
    deskSlots: 0,
    accentColor: '#5f8f73',
    floorColor: 0x2a5c3a,
  },
  rest: {
    allowedCategories: ['decorative'],
    activityTypes: ['rest'],
    deskSlots: 0,
    accentColor: '#b08a58',
    floorColor: 0x4a4a3a,
  },
  meeting: {
    allowedCategories: ['collaboration', 'decorative'],
    activityTypes: ['meet', 'collaborate'],
    deskSlots: 0,
    accentColor: '#94a3b8',
    floorColor: 0x3a4a5c,
  },
  server: {
    allowedCategories: ['compute', 'infrastructure'],
    activityTypes: ['compute'],
    deskSlots: 0,
    accentColor: '#4a8b98',
    floorColor: 0x1e2433,
  },
};

/**
 * Create a zone template with archetype defaults applied.
 * Only `slug`, `archetype`, `label`, `cx`, `cz`, `w`, `d`, `sortOrder` are required;
 * everything else falls back to the archetype's standard values.
 */
export function createZoneBlueprint(
  overrides: Pick<
    SystemZoneTemplate,
    'slug' | 'archetype' | 'label' | 'cx' | 'cz' | 'w' | 'd' | 'sortOrder'
  > &
    Partial<
      Omit<
        SystemZoneTemplate,
        'slug' | 'archetype' | 'label' | 'cx' | 'cz' | 'w' | 'd' | 'sortOrder'
      >
    >,
): SystemZoneTemplate {
  const defaults = ARCHETYPE_DEFAULTS[overrides.archetype];
  return {
    targetRoles: [],
    allowedCategories: defaults?.allowedCategories ?? ['workspace', 'infrastructure', 'decorative'],
    activityTypes: defaults?.activityTypes ?? ['work'],
    deskSlots: defaults?.deskSlots ?? 0,
    accentColor: defaults?.accentColor ?? '#64748b',
    floorColor: defaults?.floorColor ?? 0x334155,
    ...overrides,
  };
}

/** Find a system zone template by slug. */
export function findSystemTemplate(slug: string): SystemZoneTemplate | undefined {
  return SYSTEM_ZONE_TEMPLATES.find((t) => t.slug === slug);
}

/**
 * Convert a SystemZoneTemplate to a Zone object. `companyId` must be
 * non-empty; preview callers pass a sentinel (see `STUDIO_PREVIEW_COMPANY_ID`
 * / `WIZARD_PREVIEW_COMPANY_ID`).
 */
export function templateToZone(t: SystemZoneTemplate, companyId: string): Zone {
  const zoneId = normalizeZoneId(companyId, t.slug);
  return {
    zoneId,
    companyId,
    kind: 'system',
    archetype: t.archetype,
    label: t.label,
    accentColor: t.accentColor,
    floorColor: t.floorColor,
    cx: t.cx,
    cz: t.cz,
    w: t.w,
    d: t.d,
    targetRoles: t.targetRoles,
    allowedCategories: t.allowedCategories,
    activityTypes: t.activityTypes,
    deskSlots: t.deskSlots,
    sortOrder: t.sortOrder,
  };
}
