/**
 * Spatial hit testing for the 2D office Canvas view.
 * No React, no side effects — just geometry checks.
 *
 * Uses a simple linear scan (sufficient for <100 entities).
 * Employees are tested first (circular bounds), then zones (rectangular bounds),
 * matching the draw order where employees are visually above zones.
 */

// ── Types ─────────────────────────────────────────────────────────────

export type HitResult =
  | { type: 'employee'; employeeId: string }
  | { type: 'zone'; zoneId: string }
  | { type: 'empty' };

interface EmployeeEntry {
  employeeId: string;
  cx: number;
  cy: number;
  radius: number;
}

interface ZoneEntry {
  zoneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── SceneHitMap ───────────────────────────────────────────────────────

/** Spatial index for scene entities. Rebuilt when scene data changes. */
export class SceneHitMap {
  private employees: ReadonlyArray<EmployeeEntry>;
  private zones: ReadonlyArray<ZoneEntry>;

  constructor(
    employees: ReadonlyArray<{ employeeId: string; cx: number; cy: number; radius: number }>,
    zones: ReadonlyArray<{ zoneId: string; x: number; y: number; w: number; h: number }>,
  ) {
    this.employees = employees;
    this.zones = zones;
  }

  /** Hit test at canvas coordinates. Returns topmost entity (employees > zones > empty). */
  hitTest(canvasX: number, canvasY: number): HitResult {
    // Employees first — topmost in draw order
    for (const emp of this.employees) {
      const dx = canvasX - emp.cx;
      const dy = canvasY - emp.cy;
      if (dx * dx + dy * dy < emp.radius * emp.radius) {
        return { type: 'employee', employeeId: emp.employeeId };
      }
    }

    // Zones second
    for (const zone of this.zones) {
      if (
        canvasX >= zone.x &&
        canvasX <= zone.x + zone.w &&
        canvasY >= zone.y &&
        canvasY <= zone.y + zone.h
      ) {
        return { type: 'zone', zoneId: zone.zoneId };
      }
    }

    return { type: 'empty' };
  }

  /** Rebuild with new entity positions. */
  rebuild(
    employees: ReadonlyArray<{ employeeId: string; cx: number; cy: number; radius: number }>,
    zones: ReadonlyArray<{ zoneId: string; x: number; y: number; w: number; h: number }>,
  ): void {
    this.employees = employees;
    this.zones = zones;
  }

  /**
   * Zone-only hit test. Skips employees entirely.
   * Used during active drag to match the old SVG drag behavior where
   * only zones are considered as drop targets (not employees).
   */
  hitTestZone(canvasX: number, canvasY: number): HitResult {
    for (const zone of this.zones) {
      if (
        canvasX >= zone.x &&
        canvasX <= zone.x + zone.w &&
        canvasY >= zone.y &&
        canvasY <= zone.y + zone.h
      ) {
        return { type: 'zone', zoneId: zone.zoneId };
      }
    }
    return { type: 'empty' };
  }
}
