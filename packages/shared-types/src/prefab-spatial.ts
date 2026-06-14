/**
 * Spatial metadata for prefab collision and interaction anchoring.
 * All coordinates are in prefab-local space (origin = prefab center).
 * Units match the 3D scene world units (not pixels, not grid cells).
 */

/** Axis-aligned bounding box on the XZ plane, local to prefab center. */
export interface PrefabFootprint {
  /** Box center offset from prefab origin along local X axis. */
  readonly offsetX: number;
  /** Box center offset from prefab origin along local Z axis. */
  readonly offsetZ: number;
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

export interface PrefabPlacementBoundsInput {
  readonly id?: string;
  readonly prefabId: string;
  readonly x: number;
  readonly z: number;
  readonly rotation?: 0 | 90 | 180 | 270;
  readonly gridSize?: readonly [number, number];
}

export interface PrefabPlacementBounds {
  readonly id?: string;
  readonly prefabId: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PrefabPlacementZoneBounds {
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
}

export interface PrefabOffsetPlacement {
  readonly prefabId: string;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly rotation?: 0 | 90 | 180 | 270;
}

export const BUILTIN_PREFAB_IDS = Object.freeze([
  'workstation-standard',
  'workstation-compact',
  'workstation-dual',
  'server-rack-2u',
  'server-rack-4u',
  'gpu-cluster',
  'bookshelf-single',
  'bookshelf-double',
  'filing-cabinet',
  'whiteboard',
  'meeting-table-4',
  'meeting-table-8',
  'sofa-set',
  'standing-table',
  'network-switch',
  'cable-tray',
  'patch-panel',
  'plant-small',
  'plant-large',
  'coffee-table',
  'vending-machine',
  'water-cooler',
  'reading-table',
  'chair-standalone',
  'status-board',
] as const);

export type BuiltinPrefabId = (typeof BUILTIN_PREFAB_IDS)[number];

const footprint = (
  halfW: number,
  halfD: number,
  padding = 0.12,
  offsetX = 0,
  offsetZ = 0,
): PrefabFootprint => Object.freeze({ halfW, halfD, padding, offsetX, offsetZ });

export const BUILTIN_PREFAB_FOOTPRINTS = Object.freeze({
  'workstation-standard': footprint(1.28, 1.22, 0.16, 0, 0.44),
  'workstation-compact': footprint(0.92, 1.08, 0.16, 0, 0.4),
  'workstation-dual': footprint(1.35, 1.22, 0.16, 0, 0.44),
  'server-rack-2u': footprint(0.82, 1.06, 0.16),
  'server-rack-4u': footprint(0.9, 1.12, 0.16),
  'gpu-cluster': footprint(2.75, 1.18, 0.22),
  'bookshelf-single': footprint(0.9, 0.62, 0.14),
  'bookshelf-double': footprint(1.48, 0.62, 0.14),
  'filing-cabinet': footprint(0.66, 0.52, 0.12),
  whiteboard: footprint(1.28, 0.22, 0.12),
  'meeting-table-4': footprint(1.98, 2.02, 0.18),
  'meeting-table-8': footprint(3.58, 2.44, 0.2),
  'sofa-set': footprint(2.7, 1.7, 0.22),
  'standing-table': footprint(1.3, 0.62, 0.16),
  'network-switch': footprint(0.74, 0.5, 0.12),
  'cable-tray': footprint(2.36, 0.32, 0.12),
  'patch-panel': footprint(1.18, 0.4, 0.12),
  'plant-small': footprint(0.54, 0.54, 0.12),
  'plant-large': footprint(0.9, 0.9, 0.14),
  'coffee-table': footprint(0.9, 0.64, 0.12),
  'vending-machine': footprint(0.78, 1.06, 0.14),
  'water-cooler': footprint(0.54, 0.54, 0.12),
  'reading-table': footprint(1.42, 0.84, 0.14),
  'chair-standalone': footprint(0.58, 0.68, 0.12),
  'status-board': footprint(1.28, 0.22, 0.12),
} satisfies Readonly<Record<BuiltinPrefabId, PrefabFootprint>>);

const PREFAB_BOUNDS_EPSILON = 1e-6;

export function getBuiltinPrefabFootprint(
  prefabId: string,
  gridSize?: readonly [number, number],
): PrefabFootprint {
  const builtIn = (BUILTIN_PREFAB_FOOTPRINTS as Readonly<Record<string, PrefabFootprint>>)[
    prefabId
  ];
  if (builtIn) return builtIn;
  const [gridW, gridD] = gridSize ?? [1, 1];
  return footprint(Math.max(0.45, gridW * 0.55), Math.max(0.45, gridD * 0.5), 0.12);
}

export function prefabPlacementBounds(input: PrefabPlacementBoundsInput): PrefabPlacementBounds {
  const base = getBuiltinPrefabFootprint(input.prefabId, input.gridSize);
  const rotated = input.rotation === 90 || input.rotation === 270;
  const halfW = (rotated ? base.halfD : base.halfW) + base.padding;
  const halfD = (rotated ? base.halfW : base.halfD) + base.padding;
  const rotation = ((input.rotation ?? 0) * Math.PI) / 180;
  const offsetX = base.offsetX * Math.cos(rotation) + base.offsetZ * Math.sin(rotation);
  const offsetZ = base.offsetZ * Math.cos(rotation) - base.offsetX * Math.sin(rotation);
  const cx = input.x + offsetX;
  const cz = input.z + offsetZ;

  return {
    ...(input.id !== undefined ? { id: input.id } : {}),
    prefabId: input.prefabId,
    minX: cx - halfW,
    maxX: cx + halfW,
    minZ: cz - halfD,
    maxZ: cz + halfD,
  };
}

/** Center+size rect view of placement bounds (selection frames, ghost outlines). */
export function prefabBoundsToRect(bounds: PrefabPlacementBounds): {
  cx: number;
  cz: number;
  w: number;
  d: number;
} {
  return {
    cx: (bounds.minX + bounds.maxX) / 2,
    cz: (bounds.minZ + bounds.maxZ) / 2,
    w: bounds.maxX - bounds.minX,
    d: bounds.maxZ - bounds.minZ,
  };
}

export function prefabBoundsOverlap(a: PrefabPlacementBounds, b: PrefabPlacementBounds): boolean {
  return !(
    a.maxX <= b.minX + PREFAB_BOUNDS_EPSILON ||
    a.minX >= b.maxX - PREFAB_BOUNDS_EPSILON ||
    a.maxZ <= b.minZ + PREFAB_BOUNDS_EPSILON ||
    a.minZ >= b.maxZ - PREFAB_BOUNDS_EPSILON
  );
}

export function findPrefabPlacementOverlaps<T extends PrefabPlacementBoundsInput>(
  candidate: PrefabPlacementBoundsInput,
  placements: readonly T[],
): T[] {
  const candidateBounds = prefabPlacementBounds(candidate);
  return placements.filter((placement) => {
    if (candidate.id !== undefined && placement.id === candidate.id) return false;
    return prefabBoundsOverlap(candidateBounds, prefabPlacementBounds(placement));
  });
}

export function prefabFitsWithinZone(
  candidate: PrefabPlacementBoundsInput,
  zone: PrefabPlacementZoneBounds,
): boolean {
  const bounds = prefabPlacementBounds(candidate);
  const minX = zone.cx - zone.w / 2;
  const maxX = zone.cx + zone.w / 2;
  const minZ = zone.cz - zone.d / 2;
  const maxZ = zone.cz + zone.d / 2;

  return (
    bounds.minX >= minX - PREFAB_BOUNDS_EPSILON &&
    bounds.maxX <= maxX + PREFAB_BOUNDS_EPSILON &&
    bounds.minZ >= minZ - PREFAB_BOUNDS_EPSILON &&
    bounds.maxZ <= maxZ + PREFAB_BOUNDS_EPSILON
  );
}

/** An already-placed prefab the candidate must not collide with. `id` lets the
 *  evaluator skip the candidate itself when moving/rotating; `label` feeds the
 *  human-readable rejection reason. */
export interface PrefabPlacementObstacle extends PrefabPlacementBoundsInput {
  readonly label?: string;
}

export interface PrefabPlacementVerdict {
  readonly valid: boolean;
  /** Human-readable cause when blocked (e.g. `Overlaps Desk 3`); null when valid. */
  readonly reason: string | null;
}

/**
 * Single source of truth for "can this prefab sit here?" — shared by the
 * placement ghost, object drag, and rotation so the live preview and the commit
 * gate can never disagree. Zone containment is checked first, then AABB overlap
 * against every other prefab in the zone. It never relocates the candidate;
 * callers decide whether to block, revert, or toast the returned reason.
 */
export function evaluatePrefabPlacement(
  candidate: PrefabPlacementBoundsInput,
  zone: PrefabPlacementZoneBounds | null,
  obstacles: readonly PrefabPlacementObstacle[],
): PrefabPlacementVerdict {
  if (!zone) return { valid: false, reason: 'No zone in focus' };
  if (!prefabFitsWithinZone(candidate, zone)) return { valid: false, reason: 'Outside the zone' };
  const overlaps = findPrefabPlacementOverlaps(candidate, obstacles);
  if (overlaps.length > 0) {
    const names = overlaps.map((other) => other.label ?? other.prefabId).join(', ');
    return { valid: false, reason: `Overlaps ${names}` };
  }
  return { valid: true, reason: null };
}

function offsetPlacementToBoundsInput(
  placement: PrefabOffsetPlacement,
  index: number,
): PrefabPlacementBoundsInput {
  return {
    id: String(index),
    prefabId: placement.prefabId,
    x: placement.offsetX,
    z: placement.offsetZ,
    rotation: placement.rotation ?? 0,
  };
}

function offsetPlacementFits(
  placement: PrefabOffsetPlacement,
  index: number,
  accepted: readonly PrefabOffsetPlacement[],
  zoneBounds: PrefabPlacementZoneBounds | null,
): boolean {
  const input = offsetPlacementToBoundsInput(placement, index);
  if (zoneBounds && !prefabFitsWithinZone(input, zoneBounds)) return false;
  return (
    findPrefabPlacementOverlaps(
      input,
      accepted.map((item, acceptedIndex) => offsetPlacementToBoundsInput(item, acceptedIndex)),
    ).length === 0
  );
}

function placementCandidateKey(placement: PrefabOffsetPlacement): string {
  return `${placement.offsetX.toFixed(2)}:${placement.offsetZ.toFixed(2)}`;
}

function placementCandidates<T extends PrefabOffsetPlacement>(
  placement: T,
  zoneBounds: PrefabPlacementZoneBounds | null,
): T[] {
  const candidates = new Map<string, T>();
  const add = (offsetX: number, offsetZ: number) => {
    const candidate = {
      ...placement,
      offsetX: Number(offsetX.toFixed(2)),
      offsetZ: Number(offsetZ.toFixed(2)),
    };
    candidates.set(placementCandidateKey(candidate), candidate);
  };

  add(placement.offsetX, placement.offsetZ);
  const step = 0.5;
  const maxRing = 12;
  for (let ring = 1; ring <= maxRing; ring++) {
    const delta = ring * step;
    const offsets = [
      [delta, 0],
      [-delta, 0],
      [0, delta],
      [0, -delta],
      [delta, delta],
      [delta, -delta],
      [-delta, delta],
      [-delta, -delta],
      [delta * 2, 0],
      [-delta * 2, 0],
      [0, delta * 2],
      [0, -delta * 2],
    ] as const;
    for (const [dx, dz] of offsets) {
      add(placement.offsetX + dx, placement.offsetZ + dz);
    }
  }

  if (zoneBounds) {
    const minX = -zoneBounds.w / 2;
    const maxX = zoneBounds.w / 2;
    const minZ = -zoneBounds.d / 2;
    const maxZ = zoneBounds.d / 2;
    for (let offsetX = minX; offsetX <= maxX + PREFAB_BOUNDS_EPSILON; offsetX += step) {
      for (let offsetZ = minZ; offsetZ <= maxZ + PREFAB_BOUNDS_EPSILON; offsetZ += step) {
        add(offsetX, offsetZ);
      }
    }
  }

  return [...candidates.values()].sort(
    (a, b) =>
      Math.hypot(a.offsetX - placement.offsetX, a.offsetZ - placement.offsetZ) -
        Math.hypot(b.offsetX - placement.offsetX, b.offsetZ - placement.offsetZ) ||
      a.offsetZ - b.offsetZ ||
      a.offsetX - b.offsetX,
  );
}

export function resolveNonOverlappingPrefabOffsets<T extends PrefabOffsetPlacement>(
  placements: readonly T[],
  zone?: PrefabPlacementZoneBounds | null,
): T[] {
  const accepted: T[] = [];
  const localZone = zone ? { cx: 0, cz: 0, w: zone.w, d: zone.d } : null;

  placements.forEach((placement, index) => {
    for (const candidate of placementCandidates(placement, localZone)) {
      if (offsetPlacementFits(candidate, index, accepted, localZone)) {
        accepted.push(candidate);
        return;
      }
    }
    throw new Error(
      `Unable to place prefab ${placement.prefabId} without overlap inside the zone bounds.`,
    );
  });

  return accepted;
}
