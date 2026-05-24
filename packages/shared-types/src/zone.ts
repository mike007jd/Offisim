// ── Zone Domain Model ──────────────────────────────────────────────
// Single source of truth for zone types across the entire Offisim codebase.
// Shared zone contract for the renderer domain model.

import type { SemanticCategory } from './prefab.js';
import type { RoleSlug } from './roles.js';

// ── Enums ──────────────────────────────────────────────────────────

export type ZoneKind = 'system' | 'custom';

export type ZoneArchetype = 'workspace' | 'meeting' | 'server' | 'library' | 'rest';

export type ActivityType = 'work' | 'collaborate' | 'rest' | 'compute' | 'learn' | 'meet';

/** Sentinel zone_id for instances not yet assigned to a real zone. */
export const UNASSIGNED_ZONE_ID = 'unassigned';

/**
 * Sentinel companyIds for preview/create contexts that don't yet have a real
 * company UUID. Zones produced with these prefixes stay internally consistent
 * and get rewritten to the real companyId at save time via `reparentZoneId`.
 */
export const STUDIO_PREVIEW_COMPANY_ID = 'studio-preview';
export const WIZARD_PREVIEW_COMPANY_ID = 'wizard-preview';

// ── DB row shape ───────────────────────────────────────────────────

/** Mirrors the `zones` table in db-local. */
export interface ZoneRow {
  readonly zone_id: string;
  readonly company_id: string;
  readonly kind: ZoneKind;
  readonly archetype: ZoneArchetype | null;
  readonly label: string;
  readonly accent_color: string;
  readonly floor_color: number;
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
  readonly target_roles_json: string | null;
  readonly allowed_categories_json: string | null;
  readonly activity_types_json: string | null;
  readonly desk_slots: number;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
}

// ── Runtime hydrated Zone ──────────────────────────────────────────

/** Hydrated from ZoneRow — all JSON fields parsed into typed arrays. */
export interface Zone {
  readonly zoneId: string;
  readonly companyId: string;
  readonly kind: ZoneKind;
  readonly archetype: ZoneArchetype | null;
  readonly label: string;
  readonly accentColor: string;
  readonly floorColor: number;
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
  readonly targetRoles: readonly RoleSlug[];
  readonly allowedCategories: readonly SemanticCategory[];
  readonly activityTypes: readonly ActivityType[];
  readonly deskSlots: number;
  readonly sortOrder: number;
}

// ── System zone template ───────────────────────────────────────────

/** Used to seed default zones when creating a company. */
export interface SystemZoneTemplate {
  /** Stable slug, e.g. 'zone-dev'. Used to generate zone_id per company. */
  readonly slug: string;
  readonly archetype: ZoneArchetype;
  readonly label: string;
  readonly accentColor: string;
  readonly floorColor: number;
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
  readonly targetRoles: readonly RoleSlug[];
  readonly allowedCategories: readonly SemanticCategory[];
  readonly activityTypes: readonly ActivityType[];
  readonly deskSlots: number;
  readonly sortOrder: number;
}
