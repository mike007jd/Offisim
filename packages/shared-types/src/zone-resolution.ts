// ── Zone Resolution Logic ──────────────────────────────────────────
// Unified zone assignment used at all 4 trigger points:
// 1. Place (StudioGhost click)
// 2. Drag (StudioPlacedPrefabs drag-end)
// 3. Zone resize (batch re-resolve)
// 4. Data load (migration / re-resolve stale assignments)

import type { SemanticCategory } from './prefab.js';
import type { RoleSlug } from './roles.js';
import type { Zone } from './zone.js';
import { UNASSIGNED_ZONE_ID } from './zone.js';

// ── Zone ID helpers ───────────────────────────────────────────────

/**
 * Ensure a zone ID has the `companyId::slug` format.
 *
 * Note: if `zoneId` already contains `::`, it is returned verbatim — even if
 * the prefix is a foreign companyId. For reparenting (e.g. sentinel →
 * real UUID at save time), use `reparentZoneId` instead.
 */
export function normalizeZoneId(companyId: string, zoneId: string): string {
  return zoneId.includes('::') ? zoneId : `${companyId}::${zoneId}`;
}

/** Extract the bare slug from a potentially-prefixed zone ID. */
export function extractZoneSlug(zoneId: string): string {
  const parts = zoneId.split('::');
  return parts[parts.length - 1] ?? zoneId;
}

/**
 * Re-anchor a zone ID onto `companyId`, stripping any existing prefix first.
 * Use when absorbing zones from a foreign source (sentinel preview, fork,
 * import) and persisting them to the current company.
 */
export function reparentZoneId(companyId: string, zoneId: string): string {
  return normalizeZoneId(companyId, extractZoneSlug(zoneId));
}

// ── Zone matching ─────────────────────────────────────────────────

export interface ZoneMatch {
  readonly zoneId: string;
  readonly reason: 'geometric' | 'sentinel';
}

/** Check whether a point (x, z) is inside a zone's axis-aligned bounding box. */
export function isInsideZone(x: number, z: number, zone: Zone): boolean {
  const halfW = zone.w / 2;
  const halfD = zone.d / 2;
  return (
    x >= zone.cx - halfW && x <= zone.cx + halfW && z >= zone.cz - halfD && z <= zone.cz + halfD
  );
}

/**
 * Resolve which zone a position falls into.
 *
 * Priority:
 * 1. Geometric hit where the prefab category is in `allowedCategories` (best match)
 * 2. Geometric hit with any zone (category mismatch — still valid, editor shows warning)
 * 3. No hit → returns `unassigned` sentinel
 */
export function resolveZoneForPosition(
  x: number,
  z: number,
  prefabCategory: SemanticCategory,
  zones: readonly Zone[],
): ZoneMatch {
  let anyHit: Zone | null = null;

  for (const zone of zones) {
    if (!isInsideZone(x, z, zone)) continue;

    // Prefer zones whose allowed categories include this prefab's category
    if (zone.allowedCategories.length === 0 || zone.allowedCategories.includes(prefabCategory)) {
      return { zoneId: zone.zoneId, reason: 'geometric' };
    }

    // Track first geometric hit even if category doesn't match
    anyHit ??= zone;
  }

  if (anyHit) {
    return { zoneId: anyHit.zoneId, reason: 'geometric' };
  }

  return { zoneId: UNASSIGNED_ZONE_ID, reason: 'sentinel' };
}

/**
 * Find the best zone for a given role.
 * Replaces both `resolveZone(role)` from zone-config.ts and
 * `resolveEmployeeDepartment(role)` from departments.ts.
 */
export function resolveZoneForRole(role: RoleSlug, zones: readonly Zone[]): Zone | null {
  for (const zone of zones) {
    if ((zone.targetRoles as readonly string[]).includes(role)) {
      return zone;
    }
  }
  return null;
}

/**
 * Resolve which zone an employee belongs to.
 * Uses role-based matching via `resolveZoneForRole()`.
 * Replaces the old duplicated 2D/3D zone resolution logic.
 */
export function resolveEmployeeZone(
  agent: { role: RoleSlug; workstationId?: string | null },
  zones: readonly Zone[],
): string {
  return resolveZoneForRole(agent.role, zones)?.zoneId ?? UNASSIGNED_ZONE_ID;
}
