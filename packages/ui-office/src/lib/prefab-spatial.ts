import type {
  PrefabAnchor,
  PrefabAnchorSet,
  PrefabFootprint,
  PrefabSpatialSpec,
} from '@offisim/shared-types';

// ---------------------------------------------------------------------------
// Rotation utilities
// ---------------------------------------------------------------------------

/**
 * Rotate a [x, z] point by 0/90/180/270 degrees clockwise.
 */
export function rotateLocalPoint(
  point: readonly [number, number],
  rotation: 0 | 90 | 180 | 270,
): [number, number] {
  const [x, z] = point;
  switch (rotation) {
    case 0:
      return [x, z];
    case 90:
      return [z, -x];
    case 180:
      return [-x, -z];
    case 270:
      return [-z, x];
  }
}

const DEG_TO_RAD: Record<0 | 90 | 180 | 270, number> = {
  0: 0,
  90: Math.PI / 2,
  180: Math.PI,
  270: (3 * Math.PI) / 2,
};

/**
 * Transform a prefab-local anchor to world coordinates.
 * worldOrigin is [worldX, worldZ] of the prefab instance center.
 * Returns `{ position: [x, 0, z], facing }` in world space.
 */
export function toWorldAnchor(
  anchor: PrefabAnchor,
  worldOrigin: readonly [number, number],
  rotation: 0 | 90 | 180 | 270,
): { position: [number, number, number]; facing: number } {
  const [rx, rz] = rotateLocalPoint(anchor.offset, rotation);
  return {
    position: [worldOrigin[0] + rx, 0, worldOrigin[1] + rz],
    facing: anchor.facing - DEG_TO_RAD[rotation],
  };
}

// ---------------------------------------------------------------------------
// World footprint
// ---------------------------------------------------------------------------

export interface WorldFootprint {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
}

/**
 * Transform a prefab-local footprint to a world-space AABB.
 * 90/270 rotations swap halfW and halfD.
 * Padding is added to both extents.
 */
export function toWorldFootprint(
  footprint: PrefabFootprint,
  worldOrigin: readonly [number, number],
  rotation: 0 | 90 | 180 | 270,
): WorldFootprint {
  const swapped = rotation === 90 || rotation === 270;
  return {
    cx: worldOrigin[0],
    cz: worldOrigin[1],
    halfW: (swapped ? footprint.halfD : footprint.halfW) + footprint.padding,
    halfD: (swapped ? footprint.halfW : footprint.halfD) + footprint.padding,
  };
}

/**
 * AABB overlap test on the XZ plane (strict inequality — touching edges do NOT overlap).
 * Contrast `footprintInsideRect` below, which uses inclusive-edge containment.
 */
export function footprintsOverlap(a: WorldFootprint, b: WorldFootprint): boolean {
  return Math.abs(a.cx - b.cx) < a.halfW + b.halfW && Math.abs(a.cz - b.cz) < a.halfD + b.halfD;
}

export interface FootprintRect {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
}

/** Bridge from the `{cx, cz, w, d}` zone shape (ZoneRect) to the half-extent shape used here. */
export function zoneToFootprintRect(zone: {
  cx: number;
  cz: number;
  w: number;
  d: number;
}): FootprintRect {
  return { cx: zone.cx, cz: zone.cz, halfW: zone.w / 2, halfD: zone.d / 2 };
}

/** Return [width, depth] after applying rotation (swap dimensions for 90/270). */
export function getRotatedSize(w: number, d: number, rotation: number): [number, number] {
  return rotation % 180 === 0 ? [w, d] : [d, w];
}

/**
 * Resolve a world-space footprint from a prefab id; falls back to `gridSize × 0.9` when no
 * spatial spec is registered (legacy prefabs without footprint metadata).
 */
export function resolveWorldFootprint(
  prefabId: string,
  gridSize: readonly [number, number],
  position: readonly [number, number],
  rotation: 0 | 90 | 180 | 270,
): WorldFootprint {
  const spec = getSpatialSpec(prefabId);
  if (spec) return toWorldFootprint(spec.footprint, position, rotation);
  const [rw, rd] = getRotatedSize(gridSize[0], gridSize[1], rotation);
  return { cx: position[0], cz: position[1], halfW: rw * 0.9, halfD: rd * 0.9 };
}

/**
 * Clamp a footprint's center so its AABB fits inside `rect`. When the footprint is larger than
 * `rect` on an axis, the clamp pins the center to the `rect`'s low-edge bound (max wins) and the
 * footprint visibly overflows on the high side — accepted per design D3.
 */
export function clampFootprintToRect(
  footprint: WorldFootprint,
  rect: FootprintRect,
): { cx: number; cz: number } {
  const cx = Math.max(
    rect.cx - rect.halfW + footprint.halfW,
    Math.min(rect.cx + rect.halfW - footprint.halfW, footprint.cx),
  );
  const cz = Math.max(
    rect.cz - rect.halfD + footprint.halfD,
    Math.min(rect.cz + rect.halfD - footprint.halfD, footprint.cz),
  );
  return { cx, cz };
}

/** True iff `footprint`'s AABB lies fully inside `rect` (touching edges count as inside). */
export function footprintInsideRect(footprint: WorldFootprint, rect: FootprintRect): boolean {
  return (
    footprint.cx - footprint.halfW >= rect.cx - rect.halfW &&
    footprint.cx + footprint.halfW <= rect.cx + rect.halfW &&
    footprint.cz - footprint.halfD >= rect.cz - rect.halfD &&
    footprint.cz + footprint.halfD <= rect.cz + rect.halfD
  );
}

// ---------------------------------------------------------------------------
// Spatial data table
// ---------------------------------------------------------------------------

function fp(halfW: number, halfD: number, padding: number): PrefabFootprint {
  return { halfW, halfD, padding };
}

function anchor(offset: readonly [number, number], facing: number): PrefabAnchor {
  return { offset, facing };
}

function anchors(
  approach: PrefabAnchor,
  work: PrefabAnchor,
  sit?: PrefabAnchor,
  stand?: PrefabAnchor,
): PrefabAnchorSet {
  return {
    approach,
    work,
    ...(sit ? { sit } : {}),
    ...(stand ? { stand } : {}),
  };
}

const SPATIAL_SPECS: readonly PrefabSpatialSpec[] = [
  // --- Workstations ---
  {
    prefabId: 'workstation-standard',
    footprint: fp(1.2, 1.2, 0.3),
    anchors: anchors(
      anchor([0, 2.0], Math.PI),
      anchor([0, 1.4], Math.PI),
      anchor([0, 0.6], Math.PI),
    ),
    capacity: 1,
  },
  {
    prefabId: 'workstation-compact',
    footprint: fp(0.8, 1.2, 0.2),
    anchors: anchors(
      anchor([0, 1.8], Math.PI),
      anchor([0, 1.2], Math.PI),
      anchor([0, 0.5], Math.PI),
    ),
    capacity: 1,
  },
  {
    prefabId: 'workstation-dual',
    footprint: fp(1.2, 1.2, 0.3),
    anchors: anchors(
      anchor([0, 2.0], Math.PI),
      anchor([0, 1.4], Math.PI),
      anchor([0, 0.6], Math.PI),
    ),
    capacity: 1,
  },

  // --- Meeting tables ---
  {
    prefabId: 'meeting-table-4',
    footprint: fp(1.8, 1.5, 0.4),
    anchors: anchors(
      anchor([0, 2.4], Math.PI),
      anchor([0, 1.8], Math.PI),
      undefined,
      anchor([0.9, 0], Math.PI / 2),
    ),
    capacity: 4,
  },
  {
    prefabId: 'meeting-table-8',
    footprint: fp(2.8, 2.0, 0.5),
    anchors: anchors(
      anchor([0, 3.0], Math.PI),
      anchor([0, 2.4], Math.PI),
      undefined,
      anchor([1.4, 0], Math.PI / 2),
    ),
    capacity: 8,
  },

  // --- Lounge ---
  {
    prefabId: 'sofa-set',
    footprint: fp(1.8, 1.0, 0.3),
    anchors: anchors(anchor([0, 1.6], Math.PI), anchor([0, 1.0], Math.PI), anchor([0, 0], Math.PI)),
    capacity: 3,
  },
  {
    prefabId: 'standing-table',
    footprint: fp(0.6, 0.6, 0.2),
    anchors: anchors(
      anchor([0, 1.2], Math.PI),
      anchor([0, 0.8], Math.PI),
      undefined,
      anchor([0, 0.8], Math.PI),
    ),
    capacity: 2,
  },

  // --- Rest / Library furniture (capacity 0, need bounding for collision) ---
  {
    prefabId: 'coffee-table',
    footprint: fp(0.4, 0.4, 0.15),
    anchors: anchors(anchor([0, 0.7], Math.PI), anchor([0, 0.5], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'reading-table',
    footprint: fp(0.8, 0.4, 0.15),
    anchors: anchors(anchor([0, 0.8], Math.PI), anchor([0, 0.5], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'chair-standalone',
    footprint: fp(0.3, 0.3, 0.1),
    anchors: anchors(anchor([0, 0.5], Math.PI), anchor([0, 0.3], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'filing-cabinet',
    footprint: fp(0.4, 0.4, 0.1),
    anchors: anchors(anchor([0, 0.7], Math.PI), anchor([0, 0.5], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'whiteboard',
    footprint: fp(0.8, 0.3, 0.1),
    anchors: anchors(anchor([0, 0.6], Math.PI), anchor([0, 0.4], Math.PI)),
    capacity: 0,
  },

  // --- Decorative (capacity 0) ---
  {
    prefabId: 'plant-small',
    footprint: fp(0.3, 0.3, 0.1),
    anchors: anchors(anchor([0, 0.6], Math.PI), anchor([0, 0.4], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'plant-large',
    footprint: fp(0.5, 0.5, 0.15),
    anchors: anchors(anchor([0, 0.9], Math.PI), anchor([0, 0.6], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'bookshelf-single',
    footprint: fp(0.8, 0.4, 0.15),
    anchors: anchors(anchor([0, 0.8], Math.PI), anchor([0, 0.5], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'bookshelf-double',
    footprint: fp(1.6, 0.4, 0.15),
    anchors: anchors(anchor([0, 0.8], Math.PI), anchor([0, 0.5], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'server-rack-2u',
    footprint: fp(0.6, 0.8, 0.2),
    anchors: anchors(anchor([0, 1.2], Math.PI), anchor([0, 0.9], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'server-rack-4u',
    footprint: fp(0.6, 1.2, 0.2),
    anchors: anchors(anchor([0, 1.6], Math.PI), anchor([0, 1.3], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'vending-machine',
    footprint: fp(0.6, 0.5, 0.15),
    anchors: anchors(anchor([0, 0.9], Math.PI), anchor([0, 0.6], Math.PI)),
    capacity: 0,
  },
  {
    prefabId: 'water-cooler',
    footprint: fp(0.3, 0.3, 0.1),
    anchors: anchors(anchor([0, 0.6], Math.PI), anchor([0, 0.4], Math.PI)),
    capacity: 0,
  },
];

const specMap = new Map<string, PrefabSpatialSpec>(SPATIAL_SPECS.map((s) => [s.prefabId, s]));

/** Look up spatial spec by prefab ID. Returns undefined for unknown prefabs. */
export function getSpatialSpec(prefabId: string): PrefabSpatialSpec | undefined {
  return specMap.get(prefabId);
}

/** Return all registered spatial specs. */
export function getAllSpatialSpecs(): readonly PrefabSpatialSpec[] {
  return SPATIAL_SPECS;
}
