/**
 * Spatial metadata for prefab collision and interaction anchoring.
 * All coordinates are in prefab-local space (origin = prefab center).
 * Units match the 3D scene world units (not pixels, not grid cells).
 */

/** Axis-aligned bounding box on the XZ plane, local to prefab center. */
export interface PrefabFootprint {
  /** Half-extent along local X axis. */
  readonly halfW: number;
  /** Half-extent along local Z axis. */
  readonly halfD: number;
  /** Extra padding added outside the base box (collision margin). */
  readonly padding: number;
}

/** A named interaction point in prefab-local space. */
export interface PrefabAnchor {
  /** Offset from prefab center [x, z] in local space. */
  readonly offset: readonly [number, number];
  /** Facing direction in radians (0 = +Z, PI/2 = +X). Local space. */
  readonly facing: number;
}

/** Named anchor collection for a single prefab. */
export interface PrefabAnchorSet {
  /** Where an employee walks to before entering the furniture zone. */
  readonly approach: PrefabAnchor;
  /** Where an employee stands while working (e.g. behind the chair). */
  readonly work: PrefabAnchor;
  /** Where an employee sits (optional — not all furniture has seats). */
  readonly sit?: PrefabAnchor;
  /** Where an employee stands when idle near furniture (optional). */
  readonly stand?: PrefabAnchor;
}

/** Complete spatial specification for one prefab type. */
export interface PrefabSpatialSpec {
  readonly prefabId: string;
  readonly footprint: PrefabFootprint;
  readonly anchors: PrefabAnchorSet;
  /** How many employees can simultaneously occupy this prefab. */
  readonly capacity: number;
}
