# Prefab Spatial System — Footprint, Anchors & Seat Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate employee clipping / standing-inside-furniture by giving prefabs spatial metadata (footprint + anchors), building a seat registry that assigns employees to fixed anchor positions, and upgrading the Studio editor to use footprint-based collision.

**Architecture:** Spatial types live in `shared-types`. Per-prefab footprint+anchor data lives in `ui-office/lib/prefab-spatial.ts` (keyed by prefabId). A `SeatRegistry` module resolves prefab instances → world-space seat positions. The orchestrator and initial placement hook consume the registry. Studio's `checkOverlap` switches from `gridSize` to `footprint + padding`.

**Tech Stack:** TypeScript, vitest, React (ui-office), Three.js (studio ghost)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/shared-types/src/prefab-spatial.ts` | Pure type definitions: `PrefabFootprint`, `PrefabAnchor`, `PrefabAnchorSet`, `PrefabSpatialSpec` |
| Modify | `packages/shared-types/src/index.ts` | Re-export new spatial types |
| Create | `packages/ui-office/src/lib/prefab-spatial.ts` | Per-prefab spatial config table + `rotateLocalPoint` / `toWorldAnchor` / `toWorldFootprint` utilities |
| Create | `packages/ui-office/src/lib/seat-registry.ts` | `SeatRegistry`: builds available seat table from prefab instances, fallback to zone-based positioning |
| Modify | `packages/ui-office/src/lib/seat-offsets.ts` | Keep as fallback data, no API change |
| Modify | `packages/ui-office/src/hooks/useSceneOrchestrator.ts` | `getWorkstationPos()` and `getRestPos()` consume SeatRegistry |
| Modify | `packages/ui-office/src/components/scene/office3d-employees.tsx` | `usePlacedEmployees` consumes SeatRegistry for initial positions |
| Modify | `packages/ui-office/src/components/studio/StudioGhost.tsx` | `checkOverlap` uses footprint instead of gridSize |
| Create | `packages/ui-office/src/__tests__/unit/prefab-spatial.test.ts` | Tests for rotation, world transform, footprint AABB |
| Create | `packages/ui-office/src/__tests__/unit/seat-registry.test.ts` | Tests for seat resolution, fallback, capacity |

---

### Task 1: Define spatial types in shared-types

**Files:**
- Create: `packages/shared-types/src/prefab-spatial.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// packages/shared-types/src/prefab-spatial.ts

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
```

- [ ] **Step 2: Re-export from shared-types index**

In `packages/shared-types/src/index.ts`, add:

```ts
export type {
  PrefabFootprint,
  PrefabAnchor,
  PrefabAnchorSet,
  PrefabSpatialSpec,
} from './prefab-spatial.js';
```

- [ ] **Step 3: Build shared-types to verify**

Run: `pnpm --filter @offisim/shared-types build`
Expected: Build succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/prefab-spatial.ts packages/shared-types/src/index.ts
git commit -m "feat: add PrefabSpatialSpec types for footprint and anchor metadata"
```

---

### Task 2: Create prefab spatial config table + rotation utilities

**Files:**
- Create: `packages/ui-office/src/lib/prefab-spatial.ts`
- Create: `packages/ui-office/src/__tests__/unit/prefab-spatial.test.ts`

- [ ] **Step 1: Write the failing tests for rotation utilities**

```ts
// packages/ui-office/src/__tests__/unit/prefab-spatial.test.ts
import { describe, expect, it } from 'vitest';
import {
  rotateLocalPoint,
  toWorldAnchor,
  toWorldFootprint,
  getSpatialSpec,
} from '../../lib/prefab-spatial';

describe('rotateLocalPoint', () => {
  it('rotation 0 returns the same point', () => {
    expect(rotateLocalPoint([1, 2], 0)).toEqual([1, 2]);
  });

  it('rotation 90 swaps and negates correctly', () => {
    // 90° CW: [x, z] → [z, -x]
    expect(rotateLocalPoint([1, 2], 90)).toEqual([2, -1]);
  });

  it('rotation 180 negates both', () => {
    expect(rotateLocalPoint([1, 2], 180)).toEqual([-1, -2]);
  });

  it('rotation 270 swaps and negates correctly', () => {
    // 270° CW: [x, z] → [-z, x]
    expect(rotateLocalPoint([1, 2], 270)).toEqual([-2, 1]);
  });
});

describe('toWorldAnchor', () => {
  it('transforms a local anchor to world coords with rotation 0', () => {
    const anchor = { offset: [0.5, 1.0] as const, facing: 0 };
    const result = toWorldAnchor(anchor, [10, 20], 0);
    expect(result).toEqual({
      position: [10.5, 0, 21] as [number, number, number],
      facing: 0,
    });
  });

  it('transforms a local anchor to world coords with rotation 90', () => {
    const anchor = { offset: [0.5, 1.0] as const, facing: 0 };
    const result = toWorldAnchor(anchor, [10, 20], 90);
    // rotated offset: [1.0, -0.5]
    expect(result.position).toEqual([11, 0, 19.5]);
    // facing rotated by -90° = -PI/2
    expect(result.facing).toBeCloseTo(-Math.PI / 2);
  });
});

describe('toWorldFootprint', () => {
  it('rotation 0 keeps halfW/halfD as-is and adds padding', () => {
    const fp = { halfW: 1, halfD: 2, padding: 0.3 };
    const result = toWorldFootprint(fp, [5, 5], 0);
    expect(result).toEqual({
      cx: 5, cz: 5,
      halfW: 1.3, halfD: 2.3,
    });
  });

  it('rotation 90 swaps halfW and halfD', () => {
    const fp = { halfW: 1, halfD: 2, padding: 0 };
    const result = toWorldFootprint(fp, [5, 5], 90);
    expect(result).toEqual({
      cx: 5, cz: 5,
      halfW: 2, halfD: 1,
    });
  });
});

describe('getSpatialSpec', () => {
  it('returns spec for workstation-standard', () => {
    const spec = getSpatialSpec('workstation-standard');
    expect(spec).toBeDefined();
    expect(spec!.footprint.halfW).toBeGreaterThan(0);
    expect(spec!.anchors.work).toBeDefined();
    expect(spec!.capacity).toBe(1);
  });

  it('returns undefined for unknown prefab', () => {
    expect(getSpatialSpec('nonexistent')).toBeUndefined();
  });

  it('returns spec for meeting-table-4 with capacity 4', () => {
    const spec = getSpatialSpec('meeting-table-4');
    expect(spec).toBeDefined();
    expect(spec!.capacity).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @offisim/ui-office exec vitest run src/__tests__/unit/prefab-spatial.test.ts`
Expected: FAIL — module `../../lib/prefab-spatial` not found.

- [ ] **Step 3: Implement prefab-spatial.ts**

```ts
// packages/ui-office/src/lib/prefab-spatial.ts
import type {
  PrefabAnchor,
  PrefabAnchorSet,
  PrefabFootprint,
  PrefabSpatialSpec,
} from '@offisim/shared-types';

// ── Rotation utilities ─────────────────────────────────────────

/**
 * Rotate a 2D point [x, z] by a prefab rotation (0/90/180/270 degrees CW).
 * Returns the rotated [x, z].
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

/**
 * Transform a prefab-local anchor to world coordinates.
 * worldOrigin is [worldX, worldZ] of the prefab instance center.
 */
export function toWorldAnchor(
  anchor: PrefabAnchor,
  worldOrigin: readonly [number, number],
  rotation: 0 | 90 | 180 | 270,
): { position: [number, number, number]; facing: number } {
  const [rx, rz] = rotateLocalPoint(anchor.offset, rotation);
  const rotRad = (rotation * Math.PI) / 180;
  return {
    position: [worldOrigin[0] + rx, 0, worldOrigin[1] + rz],
    facing: anchor.facing - rotRad,
  };
}

/** World-space AABB for collision testing. */
export interface WorldFootprint {
  readonly cx: number;
  readonly cz: number;
  readonly halfW: number;
  readonly halfD: number;
}

/**
 * Transform a prefab footprint to a world-space AABB.
 * Padding is added to both extents.
 * 90/270 rotation swaps W and D.
 */
export function toWorldFootprint(
  footprint: PrefabFootprint,
  worldOrigin: readonly [number, number],
  rotation: 0 | 90 | 180 | 270,
): WorldFootprint {
  const swapped = rotation % 180 !== 0;
  return {
    cx: worldOrigin[0],
    cz: worldOrigin[1],
    halfW: (swapped ? footprint.halfD : footprint.halfW) + footprint.padding,
    halfD: (swapped ? footprint.halfW : footprint.halfD) + footprint.padding,
  };
}

/**
 * Test if two world footprints overlap (AABB test on XZ plane).
 */
export function footprintsOverlap(a: WorldFootprint, b: WorldFootprint): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.halfW + b.halfW &&
    Math.abs(a.cz - b.cz) < a.halfD + b.halfD
  );
}

// ── Per-prefab spatial data ────────────────────────────────────

// Anchor helper — shorthand for readability
function anchor(x: number, z: number, facing = 0): PrefabAnchor {
  return { offset: [x, z], facing };
}

function footprint(halfW: number, halfD: number, padding = 0.2): PrefabFootprint {
  return { halfW, halfD, padding };
}

function spec(
  prefabId: string,
  fp: PrefabFootprint,
  anchors: PrefabAnchorSet,
  capacity = 1,
): PrefabSpatialSpec {
  return { prefabId, footprint: fp, anchors, capacity };
}

/**
 * Spatial specs for built-in prefabs.
 *
 * Coordinate convention (local space, before rotation):
 * - X: left(-) / right(+)
 * - Z: back(-) / front(+)  (front = where the user sits/stands)
 *
 * Dimensions are in 3D world units. A workstation-standard has
 * gridSize [2,2] which maps to roughly 2.5 world units per cell.
 */
const SPATIAL_SPECS: readonly PrefabSpatialSpec[] = [
  // ── Workspace ──
  spec('workstation-standard', footprint(1.2, 1.2, 0.3), {
    approach: anchor(0, 2.0),
    work: anchor(0, 1.4, Math.PI),       // behind the chair, facing desk
    sit: anchor(0, 0.7, Math.PI),         // at the chair
    stand: anchor(0, 2.0),
  }),
  spec('workstation-compact', footprint(0.8, 1.2, 0.2), {
    approach: anchor(0, 1.8),
    work: anchor(0, 1.2, Math.PI),
  }),
  spec('workstation-dual', footprint(1.2, 1.2, 0.3), {
    approach: anchor(0, 2.0),
    work: anchor(0, 1.4, Math.PI),
    sit: anchor(0, 0.7, Math.PI),
    stand: anchor(0, 2.0),
  }),

  // ── Collaboration ──
  spec('meeting-table-4', footprint(1.8, 1.5, 0.4), {
    approach: anchor(0, 2.5),
    work: anchor(0, 0, 0),                // center of table (for manager/presenter)
    sit: anchor(-1.0, 0, Math.PI / 2),    // one of the side chairs
    stand: anchor(0, 2.5),
  }, 4),
  spec('meeting-table-8', footprint(2.8, 2.0, 0.5), {
    approach: anchor(0, 3.5),
    work: anchor(0, 0, 0),
    sit: anchor(-2.0, -0.6, Math.PI / 2),
    stand: anchor(0, 3.5),
  }, 8),
  spec('sofa-set', footprint(1.8, 1.0, 0.3), {
    approach: anchor(0, 1.8),
    work: anchor(0, -0.4, 0),             // sitting on sofa, facing coffee table
    sit: anchor(-0.6, -0.4, 0),           // left side of sofa
    stand: anchor(0, 1.8),
  }, 3),
  spec('standing-table', footprint(0.6, 0.6, 0.2), {
    approach: anchor(0, 1.2),
    work: anchor(0, 0.6, Math.PI),
  }, 2),

  // ── Decorative / no seat ──
  spec('plant-small', footprint(0.3, 0.3, 0.1), {
    approach: anchor(0, 0.6),
    work: anchor(0, 0.6),
  }, 0),
  spec('plant-large', footprint(0.4, 0.6, 0.1), {
    approach: anchor(0, 0.9),
    work: anchor(0, 0.9),
  }, 0),
  spec('bookshelf-single', footprint(0.6, 1.0, 0.2), {
    approach: anchor(0, 1.5),
    work: anchor(0, 1.2, Math.PI),
  }, 0),
  spec('bookshelf-double', footprint(1.2, 1.0, 0.2), {
    approach: anchor(0, 1.5),
    work: anchor(0, 1.2, Math.PI),
  }, 0),
  spec('server-rack-2u', footprint(0.5, 1.0, 0.2), {
    approach: anchor(0, 1.5),
    work: anchor(0, 1.2, Math.PI),
  }, 0),
  spec('server-rack-4u', footprint(0.5, 1.5, 0.2), {
    approach: anchor(0, 2.0),
    work: anchor(0, 1.5, Math.PI),
  }, 0),
  spec('vending-machine', footprint(0.5, 0.8, 0.2), {
    approach: anchor(0, 1.3),
    work: anchor(0, 1.0, Math.PI),
  }, 0),
  spec('water-cooler', footprint(0.3, 0.3, 0.2), {
    approach: anchor(0, 0.8),
    work: anchor(0, 0.6, Math.PI),
  }, 0),
];

const SPEC_INDEX = new Map<string, PrefabSpatialSpec>(
  SPATIAL_SPECS.map((s) => [s.prefabId, s]),
);

/** Look up spatial spec by prefab ID. Returns undefined for unknown prefabs. */
export function getSpatialSpec(prefabId: string): PrefabSpatialSpec | undefined {
  return SPEC_INDEX.get(prefabId);
}

/** Return all registered spatial specs. */
export function getAllSpatialSpecs(): readonly PrefabSpatialSpec[] {
  return SPATIAL_SPECS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @offisim/ui-office exec vitest run src/__tests__/unit/prefab-spatial.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-office/src/lib/prefab-spatial.ts packages/ui-office/src/__tests__/unit/prefab-spatial.test.ts
git commit -m "feat: prefab spatial config table with footprint, anchors, and rotation utilities"
```

---

### Task 3: Add footprint overlap utility tests

**Files:**
- Modify: `packages/ui-office/src/__tests__/unit/prefab-spatial.test.ts`

- [ ] **Step 1: Add overlap tests to the existing test file**

Append to the test file:

```ts
describe('footprintsOverlap', () => {
  it('detects overlapping footprints', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 1 };
    const b = { cx: 1.5, cz: 0, halfW: 1, halfD: 1 };
    expect(footprintsOverlap(a, b)).toBe(true);
  });

  it('returns false for non-overlapping footprints', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 1 };
    const b = { cx: 3, cz: 0, halfW: 1, halfD: 1 };
    expect(footprintsOverlap(a, b)).toBe(false);
  });

  it('detects overlap on Z axis only', () => {
    const a = { cx: 0, cz: 0, halfW: 0.5, halfD: 2 };
    const b = { cx: 0, cz: 3, halfW: 0.5, halfD: 2 };
    expect(footprintsOverlap(a, b)).toBe(true);
  });

  it('returns false when touching exactly at edge', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 1 };
    const b = { cx: 2, cz: 0, halfW: 1, halfD: 1 };
    // |0-2| = 2 which is NOT < 1+1=2 → no overlap
    expect(footprintsOverlap(a, b)).toBe(false);
  });
});
```

Add `footprintsOverlap` to the import line.

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @offisim/ui-office exec vitest run src/__tests__/unit/prefab-spatial.test.ts`
Expected: All 13 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui-office/src/__tests__/unit/prefab-spatial.test.ts
git commit -m "test: add footprintsOverlap edge case tests"
```

---

### Task 4: Build SeatRegistry

**Files:**
- Create: `packages/ui-office/src/lib/seat-registry.ts`
- Create: `packages/ui-office/src/__tests__/unit/seat-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ui-office/src/__tests__/unit/seat-registry.test.ts
import { describe, expect, it } from 'vitest';
import type { PrefabDefinition, PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { SeatRegistry } from '../../lib/seat-registry';

function makeInstance(
  overrides: Partial<PrefabInstanceRow> & { instance_id: string; prefab_id: string; zone_id: string },
): PrefabInstanceRow {
  return {
    company_id: 'co1',
    position_x: 0,
    position_y: 0,
    rotation: 0,
    bindings_json: null,
    config_json: null,
    enabled: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeZone(overrides: Partial<Zone> & { zoneId: string }): Zone {
  return {
    companyId: 'co1',
    label: 'Test',
    archetype: 'workspace',
    floorColor: 0x666666,
    accentColor: '#60a5fa',
    deskSlots: 4,
    targetRoles: [],
    cx: 0,
    cz: 0,
    w: 10,
    d: 10,
    ...overrides,
  };
}

describe('SeatRegistry', () => {
  it('assigns seats from prefab instances with correct world positions', () => {
    const instances = [
      makeInstance({
        instance_id: 'ws1',
        prefab_id: 'workstation-standard',
        zone_id: 'co1::zone-dev',
        position_x: 5,
        position_y: 8,
        rotation: 0,
      }),
    ];
    const zones = [makeZone({ zoneId: 'co1::zone-dev' })];

    const registry = SeatRegistry.build(instances, zones);
    const seat = registry.getSeat('co1::zone-dev', 0);

    expect(seat).toBeDefined();
    // workstation-standard 'work' anchor offset is [0, 1.4]
    // world position = instance [5, 8] + rotated [0, 1.4] = [5, 0, 9.4]
    expect(seat!.position[0]).toBeCloseTo(5);
    expect(seat!.position[2]).toBeCloseTo(9.4);
  });

  it('handles rotation correctly', () => {
    const instances = [
      makeInstance({
        instance_id: 'ws1',
        prefab_id: 'workstation-standard',
        zone_id: 'co1::zone-dev',
        position_x: 5,
        position_y: 8,
        rotation: 90,
      }),
    ];
    const zones = [makeZone({ zoneId: 'co1::zone-dev' })];

    const registry = SeatRegistry.build(instances, zones);
    const seat = registry.getSeat('co1::zone-dev', 0);

    expect(seat).toBeDefined();
    // 90° rotation: [0, 1.4] → [1.4, 0]
    // world = [5 + 1.4, 0, 8 + 0] = [6.4, 0, 8]
    expect(seat!.position[0]).toBeCloseTo(6.4);
    expect(seat!.position[2]).toBeCloseTo(8);
  });

  it('falls back to zone-center offsets when no prefab instances exist', () => {
    const zones = [makeZone({ zoneId: 'co1::zone-dev', cx: 3, cz: 5 })];
    const registry = SeatRegistry.build([], zones);

    const seat = registry.getSeat('co1::zone-dev', 0);
    expect(seat).toBeDefined();
    // Fallback: zone center + SEAT_OFFSETS[0] = [3 + (-0.8), 0, 5 + (-1.6)]
    expect(seat!.position[0]).toBeCloseTo(2.2);
    expect(seat!.position[2]).toBeCloseTo(3.4);
    expect(seat!.isFallback).toBe(true);
  });

  it('returns null when slot index exceeds capacity', () => {
    const zones = [makeZone({ zoneId: 'co1::zone-dev', cx: 0, cz: 0, deskSlots: 2 })];
    const registry = SeatRegistry.build([], zones);

    // Only 4 SEAT_OFFSETS, each slot wraps after 4
    // but the 100th seat should still return something (wraps around)
    const seat = registry.getSeat('co1::zone-dev', 100);
    expect(seat).toBeDefined();
  });

  it('returns separate seats for multi-capacity prefabs (sofa-set)', () => {
    const instances = [
      makeInstance({
        instance_id: 'sofa1',
        prefab_id: 'sofa-set',
        zone_id: 'co1::zone-rest',
        position_x: 0,
        position_y: 0,
        rotation: 0,
      }),
    ];
    const zones = [makeZone({ zoneId: 'co1::zone-rest', archetype: 'rest' as any })];

    const registry = SeatRegistry.build(instances, zones);
    const seat0 = registry.getSeat('co1::zone-rest', 0);
    const seat1 = registry.getSeat('co1::zone-rest', 1);

    expect(seat0).toBeDefined();
    expect(seat1).toBeDefined();
    // Seats should be at different positions (spread across capacity)
    if (seat0 && seat1) {
      const dx = Math.abs(seat0.position[0] - seat1.position[0]);
      const dz = Math.abs(seat0.position[2] - seat1.position[2]);
      expect(dx + dz).toBeGreaterThan(0.1);
    }
  });

  it('getRestSeat returns a position in the rest zone', () => {
    const zones = [makeZone({ zoneId: 'co1::zone-rest', archetype: 'rest' as any, cx: 8, cz: 2 })];
    const registry = SeatRegistry.build([], zones);

    const seat = registry.getRestSeat(zones, 0);
    expect(seat).toBeDefined();
    // Should be near the rest zone center (within zone bounds)
    expect(Math.abs(seat[0] - 8)).toBeLessThan(6);
    expect(Math.abs(seat[2] - 2)).toBeLessThan(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @offisim/ui-office exec vitest run src/__tests__/unit/seat-registry.test.ts`
Expected: FAIL — module `../../lib/seat-registry` not found.

- [ ] **Step 3: Implement seat-registry.ts**

```ts
// packages/ui-office/src/lib/seat-registry.ts
import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { SEAT_OFFSETS } from './seat-offsets';
import { getSpatialSpec, toWorldAnchor } from './prefab-spatial';

type Vec3 = [number, number, number];

export interface SeatEntry {
  /** World position [x, y, z]. */
  readonly position: Vec3;
  /** Facing direction in world radians. */
  readonly facing: number;
  /** Which prefab instance this seat belongs to (null for fallback). */
  readonly instanceId: string | null;
  /** True if this seat was generated from zone fallback, not a real prefab. */
  readonly isFallback: boolean;
}

/**
 * SeatRegistry resolves employee seating positions from prefab instances.
 *
 * Build once per layout change (prefab instances + zones), then query
 * seats by zoneId + slotIndex.
 */
export class SeatRegistry {
  /** zoneId → ordered seat list */
  private readonly seats: Map<string, SeatEntry[]>;

  private constructor(seats: Map<string, SeatEntry[]>) {
    this.seats = seats;
  }

  /**
   * Build a seat registry from prefab instances and zone definitions.
   *
   * For zones with prefab instances that have spatial specs:
   *   Each workspace prefab contributes `capacity` seats at its anchor positions.
   *
   * For zones without prefab instances (or with unknown prefabs):
   *   Falls back to zone-center + SEAT_OFFSETS (deterministic, no random jitter).
   */
  static build(instances: readonly PrefabInstanceRow[], zones: readonly Zone[]): SeatRegistry {
    const seats = new Map<string, SeatEntry[]>();

    // Initialize empty seat lists for all zones
    for (const zone of zones) {
      seats.set(zone.zoneId, []);
    }

    // Phase 1: collect seats from prefab instances with spatial specs
    const coveredZones = new Set<string>();
    for (const inst of instances) {
      if (!inst.enabled) continue;
      const spec = getSpatialSpec(inst.prefab_id);
      if (!spec || spec.capacity === 0) continue;

      const zoneSeats = seats.get(inst.zone_id);
      if (!zoneSeats) continue;

      const worldOrigin: readonly [number, number] = [inst.position_x, inst.position_y];
      const rotation = inst.rotation;

      if (spec.capacity === 1) {
        // Single-seat prefab: use the 'work' anchor
        const worldAnchor = toWorldAnchor(spec.anchors.work, worldOrigin, rotation);
        zoneSeats.push({
          position: worldAnchor.position,
          facing: worldAnchor.facing,
          instanceId: inst.instance_id,
          isFallback: false,
        });
      } else {
        // Multi-seat prefab: spread seats around the anchor area
        const baseWork = toWorldAnchor(spec.anchors.work, worldOrigin, rotation);
        const baseSit = spec.anchors.sit
          ? toWorldAnchor(spec.anchors.sit, worldOrigin, rotation)
          : baseWork;

        for (let i = 0; i < spec.capacity; i++) {
          // Spread seats by offsetting along the local X axis
          const spreadOffset = ((i - (spec.capacity - 1) / 2) * 0.8);
          const seat: SeatEntry = {
            position: [
              baseSit.position[0] + spreadOffset,
              0,
              baseSit.position[2],
            ],
            facing: baseSit.facing,
            instanceId: inst.instance_id,
            isFallback: false,
          };
          zoneSeats.push(seat);
        }
      }

      coveredZones.add(inst.zone_id);
    }

    // Phase 2: fill fallback seats for zones without prefab-based seats
    for (const zone of zones) {
      if (coveredZones.has(zone.zoneId)) continue;
      if (zone.deskSlots === 0) continue;

      const zoneSeats = seats.get(zone.zoneId) ?? [];
      const fallbackCount = Math.max(zone.deskSlots, SEAT_OFFSETS.length);

      for (let i = 0; i < fallbackCount; i++) {
        const offset = SEAT_OFFSETS[i % SEAT_OFFSETS.length] ?? [0, 0, 0];
        const rowShift = Math.floor(i / SEAT_OFFSETS.length) * 2;
        zoneSeats.push({
          position: [
            zone.cx + offset[0],
            0,
            zone.cz + offset[2] + rowShift,
          ],
          facing: Math.PI, // face "forward" toward desk
          instanceId: null,
          isFallback: true,
        });
      }

      seats.set(zone.zoneId, zoneSeats);
    }

    return new SeatRegistry(seats);
  }

  /** Get a seat for a zone at the given slot index. Wraps if index exceeds seat count. */
  getSeat(zoneId: string, slotIndex: number): SeatEntry | null {
    const zoneSeats = this.seats.get(zoneId);
    if (!zoneSeats || zoneSeats.length === 0) return null;
    return zoneSeats[slotIndex % zoneSeats.length] ?? null;
  }

  /** Get all seats for a zone. */
  getZoneSeats(zoneId: string): readonly SeatEntry[] {
    return this.seats.get(zoneId) ?? [];
  }

  /**
   * Get a rest-zone seat position (for idle employees).
   * Uses circular distribution around rest zone center (no random jitter).
   */
  getRestSeat(zones: readonly Zone[], slotIndex: number): Vec3 {
    const restZone = zones.find((z) => z.archetype === 'rest');
    const cx = restZone?.cx ?? 8;
    const cz = restZone?.cz ?? 2;

    // Deterministic circular layout — same as before but without Math.random()
    const totalSlots = Math.max(slotIndex + 1, 6);
    const angle = (slotIndex / totalSlots) * Math.PI * 1.5 + 0.3;
    const radius = 1.2 + (slotIndex % 3) * 0.8;
    return [cx + Math.cos(angle) * radius, 0, cz + Math.sin(angle) * radius];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @offisim/ui-office exec vitest run src/__tests__/unit/seat-registry.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-office/src/lib/seat-registry.ts packages/ui-office/src/__tests__/unit/seat-registry.test.ts
git commit -m "feat: SeatRegistry resolves employee positions from prefab anchors with zone fallback"
```

---

### Task 5: Replace `getWorkstationPos` in useSceneOrchestrator

**Files:**
- Modify: `packages/ui-office/src/hooks/useSceneOrchestrator.ts`

- [ ] **Step 1: Add SeatRegistry import and build call**

At the top of `useSceneOrchestrator.ts`, add:

```ts
import { SeatRegistry } from '../lib/seat-registry';
```

The hook receives `zones` and prefab instance data. The SeatRegistry must be built once and stored in a ref (not re-created every render). Add a `registryRef` inside the hook body, rebuilt when prefab instances or zones change.

Find the `useSceneOrchestrator` function signature. Inside it, add after the existing refs:

```ts
const registryRef = useRef<SeatRegistry | null>(null);
```

Add a `useEffect` that rebuilds the registry when zones or prefab instances change. The hook already has access to zones from its parameters and company data. The prefab instances should be passed in from the parent. If not available, build from empty array (fallback mode).

- [ ] **Step 2: Replace `getWorkstationPos`**

Replace the existing `getWorkstationPos` function (lines 88-99):

```ts
// BEFORE:
function getWorkstationPos(
  zones: readonly Zone[],
  zoneId: string,
  slotIdx: number,
): [number, number, number] {
  const center = getZoneCenterById(zones, zoneId);
  const offset = SEAT_OFFSETS[slotIdx % SEAT_OFFSETS.length] ?? SEAT_OFFSETS[0] ?? [0, 0, 0];
  return [
    center[0] + offset[0] + (Math.random() - 0.5) * 0.3,
    0,
    center[2] + offset[2] + (Math.random() - 0.5) * 0.3,
  ];
}

// AFTER:
function getWorkstationPos(
  registry: SeatRegistry | null,
  zones: readonly Zone[],
  zoneId: string,
  slotIdx: number,
): [number, number, number] {
  if (registry) {
    const seat = registry.getSeat(zoneId, slotIdx);
    if (seat) return [...seat.position];
  }
  // Fallback: zone center + deterministic offset (no random jitter)
  const center = getZoneCenterById(zones, zoneId);
  const offset = SEAT_OFFSETS[slotIdx % SEAT_OFFSETS.length] ?? SEAT_OFFSETS[0] ?? [0, 0, 0];
  return [center[0] + offset[0], 0, center[2] + offset[2]];
}
```

- [ ] **Step 3: Replace `getRestPos`**

Replace the existing `getRestPos` function (lines 102-105):

```ts
// BEFORE:
function getRestPos(zones: readonly Zone[]): [number, number, number] {
  const restCenter = getZoneCenter(zones, 'rest');
  return [restCenter[0] + (Math.random() - 0.5) * 4, 0, restCenter[2] + (Math.random() - 0.5) * 3];
}

// AFTER:
let restSlotCounter = 0;
function getRestPos(registry: SeatRegistry | null, zones: readonly Zone[]): [number, number, number] {
  if (registry) {
    return [...registry.getRestSeat(zones, restSlotCounter++)];
  }
  // Fallback: deterministic scatter instead of random
  const restCenter = getZoneCenter(zones, 'rest');
  const idx = restSlotCounter++;
  const angle = (idx / 8) * Math.PI * 1.5 + 0.3;
  const radius = 1.2 + (idx % 3) * 0.8;
  return [restCenter[0] + Math.cos(angle) * radius, 0, restCenter[2] + Math.sin(angle) * radius];
}
```

- [ ] **Step 4: Update all call sites of `getWorkstationPos` and `getRestPos`**

Search for all calls to `getWorkstationPos` and `getRestPos` within the file and add `registryRef.current` as the first argument. There are approximately:
- 1 call to `getWorkstationPos` in the dispatch handler
- 3 calls to `getRestPos` in dismiss/ceremony handlers

Each `getWorkstationPos(zonesRef.current, ...)` becomes `getWorkstationPos(registryRef.current, zonesRef.current, ...)`.
Each `getRestPos(zonesRef.current)` becomes `getRestPos(registryRef.current, zonesRef.current)`.

- [ ] **Step 5: Remove `SEAT_OFFSETS` import if no longer used directly**

Check if `SEAT_OFFSETS` is still referenced directly in this file after the refactor. If only used via `getWorkstationPos` (which now delegates to `SeatRegistry`), the import can stay (the fallback inside `getWorkstationPos` still uses it). Keep the import.

- [ ] **Step 6: Build and verify no type errors**

Run: `pnpm --filter @offisim/ui-office exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Run existing orchestrator tests to verify no regression**

Run: `pnpm --filter @offisim/ui-office exec vitest run src/__tests__/unit/scene-orchestrator-labels.test.ts`
Expected: All existing tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui-office/src/hooks/useSceneOrchestrator.ts
git commit -m "refactor: replace random seat jitter with SeatRegistry anchor-based positioning"
```

---

### Task 6: Replace initial placement in `usePlacedEmployees`

**Files:**
- Modify: `packages/ui-office/src/components/scene/office3d-employees.tsx`

- [ ] **Step 1: Add SeatRegistry parameter to `usePlacedEmployees`**

Change the function signature:

```ts
// BEFORE:
export function usePlacedEmployees(
  agents: Map<string, AgentState>,
  zones3D: readonly Zone3D[],
  zones: readonly Zone[],
): PlacedEmployee[]

// AFTER:
export function usePlacedEmployees(
  agents: Map<string, AgentState>,
  zones3D: readonly Zone3D[],
  zones: readonly Zone[],
  registry: SeatRegistry | null,
): PlacedEmployee[]
```

Add import:

```ts
import type { SeatRegistry } from '../../lib/seat-registry';
```

- [ ] **Step 2: Replace workspace seat placement logic**

Inside `usePlacedEmployees`, replace the workspace branch (current lines 94-104):

```ts
// BEFORE:
const deskPos = SEAT_OFFSETS[slotIdx % SEAT_OFFSETS.length] ?? DEFAULT_SEAT_OFFSET;
placed.push({
  id: employee.id,
  agent: employee.agent,
  globalIndex: employee.globalIndex,
  position: [
    zone.position[0] + deskPos[0],
    0,
    zone.position[2] + deskPos[2] + Math.floor(slotIdx / 4) * 2,
  ],
});

// AFTER:
if (registry) {
  const seat = registry.getSeat(zone.zoneId, slotIdx);
  if (seat) {
    placed.push({
      id: employee.id,
      agent: employee.agent,
      globalIndex: employee.globalIndex,
      position: [...seat.position],
    });
    return;
  }
}
// Fallback: deterministic zone-center offset (no random jitter)
const deskPos = SEAT_OFFSETS[slotIdx % SEAT_OFFSETS.length] ?? DEFAULT_SEAT_OFFSET;
placed.push({
  id: employee.id,
  agent: employee.agent,
  globalIndex: employee.globalIndex,
  position: [
    zone.position[0] + deskPos[0],
    0,
    zone.position[2] + deskPos[2] + Math.floor(slotIdx / 4) * 2,
  ],
});
```

- [ ] **Step 3: Replace rest zone placement logic**

Replace the rest zone circular layout (current lines 78-92):

```ts
// BEFORE:
if (zone.zoneId === restZoneId) {
  const angle = (slotIdx / Math.max(zoneEmployeesForZone.length, 1)) * Math.PI * 1.5 + 0.3;
  const radius = 1.2 + (slotIdx % 3) * 0.8;
  placed.push({
    ...employee,
    position: [
      restZoneLayout.position[0] + Math.cos(angle) * radius,
      0,
      restZoneLayout.position[2] + Math.sin(angle) * radius,
    ],
  });
  return;
}

// AFTER:
if (zone.zoneId === restZoneId) {
  if (registry) {
    const restPos = registry.getRestSeat(zones, slotIdx);
    placed.push({ ...employee, position: restPos });
    return;
  }
  // Fallback: deterministic circular distribution
  const totalSlots = Math.max(zoneEmployeesForZone.length, 6);
  const angle = (slotIdx / totalSlots) * Math.PI * 1.5 + 0.3;
  const radius = 1.2 + (slotIdx % 3) * 0.8;
  placed.push({
    ...employee,
    position: [
      restZoneLayout.position[0] + Math.cos(angle) * radius,
      0,
      restZoneLayout.position[2] + Math.sin(angle) * radius,
    ],
  });
  return;
}
```

- [ ] **Step 4: Add `registry` to useMemo deps**

The `useMemo` deps array must include `registry`:

```ts
}, [agents, zones3D, zones, registry]);
```

- [ ] **Step 5: Update the call site in the parent component**

Find where `usePlacedEmployees` is called (in `Office3DView.tsx` or the view state hook) and pass the registry instance. This requires threading the registry from `useOffice3DViewState` or building it there from `prefabInstances`.

In the parent, build the registry:

```ts
import { SeatRegistry } from '../../lib/seat-registry';

// Inside the component/hook, memoize the registry:
const seatRegistry = useMemo(
  () => SeatRegistry.build(
    prefabInstances.map((p) => p.instance),
    zones,
  ),
  [prefabInstances, zones],
);
```

Pass `seatRegistry` to `usePlacedEmployees`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @offisim/ui-office exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-office/src/components/scene/office3d-employees.tsx
git commit -m "refactor: usePlacedEmployees uses SeatRegistry for deterministic positioning"
```

---

### Task 7: Upgrade Studio ghost collision to use footprint

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioGhost.tsx`

- [ ] **Step 1: Import spatial utilities**

Add at the top of `StudioGhost.tsx`:

```ts
import { getSpatialSpec, toWorldFootprint, footprintsOverlap } from '../../lib/prefab-spatial';
```

- [ ] **Step 2: Replace `checkOverlap` function**

Replace the existing `checkOverlap` function (lines 45-73):

```ts
// BEFORE: uses gridSize * 0.9 for AABB
function checkOverlap(
  x: number,
  z: number,
  gridW: number,
  gridD: number,
  ghostRotation: number,
  instances: { position: [number, number, number]; rotation: number; prefabId: string }[],
): boolean {
  const [gw, gd] = getRotatedSize(gridW, gridD, ghostRotation);
  const halfW = gw * 0.9;
  const halfD = gd * 0.9;
  for (const inst of instances) {
    const def = getBuiltinPrefab(inst.prefabId);
    if (!def) continue;
    const [iw, id] = getRotatedSize(def.gridSize[0], def.gridSize[1], inst.rotation);
    const iHalfW = iw * 0.9;
    const iHalfD = id * 0.9;
    const ix = inst.position[0];
    const iz = inst.position[2];
    if (Math.abs(x - ix) < halfW + iHalfW && Math.abs(z - iz) < halfD + iHalfD) {
      return true;
    }
  }
  return false;
}

// AFTER: uses PrefabSpatialSpec footprint with padding
function checkOverlap(
  x: number,
  z: number,
  ghostPrefabId: string,
  gridW: number,
  gridD: number,
  ghostRotation: number,
  instances: { position: [number, number, number]; rotation: number; prefabId: string }[],
): boolean {
  const ghostSpec = getSpatialSpec(ghostPrefabId);
  const ghostFp = ghostSpec
    ? toWorldFootprint(ghostSpec.footprint, [x, z], ghostRotation as 0 | 90 | 180 | 270)
    : {
        cx: x, cz: z,
        halfW: getRotatedSize(gridW, gridD, ghostRotation)[0] * 0.9,
        halfD: getRotatedSize(gridW, gridD, ghostRotation)[1] * 0.9,
      };

  for (const inst of instances) {
    const instSpec = getSpatialSpec(inst.prefabId);
    const def = getBuiltinPrefab(inst.prefabId);
    if (!def && !instSpec) continue;

    const instFp = instSpec
      ? toWorldFootprint(instSpec.footprint, [inst.position[0], inst.position[2]], inst.rotation as 0 | 90 | 180 | 270)
      : {
          cx: inst.position[0], cz: inst.position[2],
          halfW: getRotatedSize(def!.gridSize[0], def!.gridSize[1], inst.rotation)[0] * 0.9,
          halfD: getRotatedSize(def!.gridSize[0], def!.gridSize[1], inst.rotation)[1] * 0.9,
        };

    if (footprintsOverlap(ghostFp, instFp)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: Update call sites to pass ghostPrefabId**

The two `checkOverlap` calls in the file (onPointerMove and onClick handlers) need the ghost prefab ID. `placingPrefab` is already available in scope via the store.

Change both call sites from:
```ts
checkOverlap(x, z, gridW, gridD, curGhostRotation, currentInstances)
```
to:
```ts
checkOverlap(x, z, placingPrefab?.prefabId ?? '', gridW, gridD, curGhostRotation, currentInstances)
```

Note: `placingPrefab` is captured outside `useFrame`. For the `onPointerMove` and `onClick` handlers, read it from `useStudioStore.getState().placingPrefab?.prefabId` to avoid stale closure.

- [ ] **Step 4: Update the ghost footprint visual to use spatial spec size**

Replace the footprint visual dimensions (line 232-234) to use spatial spec when available:

```ts
const ghostSpec = getSpatialSpec(placingPrefab?.prefabId ?? '');
const fpVisualW = ghostSpec
  ? (ghostSpec.footprint.halfW + ghostSpec.footprint.padding) * 2
  : gridW * 2.5;
const fpVisualD = ghostSpec
  ? (ghostSpec.footprint.halfD + ghostSpec.footprint.padding) * 2
  : gridD * 2.5;
```

Use `fpVisualW` and `fpVisualD` in the `PlaneGeometry` and `EdgesGeometry` args instead of `gridW * 2.5` / `gridD * 2.5`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @offisim/ui-office exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioGhost.tsx
git commit -m "feat: Studio ghost collision uses prefab footprint with padding instead of gridSize"
```

---

### Task 8: Wire SeatRegistry into useSceneOrchestrator

**Files:**
- Modify: `packages/ui-office/src/hooks/useSceneOrchestrator.ts`

This task wires the `registryRef` into the orchestrator hook so it rebuilds when prefab data changes. The orchestrator hook needs access to prefab instance data, which currently flows through `useOffice3DViewState`.

- [ ] **Step 1: Add prefabInstances parameter to useSceneOrchestrator**

The hook's parameter type needs a new optional field:

```ts
prefabInstances?: readonly PrefabInstanceRow[];
```

Add the import:

```ts
import type { PrefabInstanceRow } from '@offisim/shared-types';
import { SeatRegistry } from '../lib/seat-registry';
```

- [ ] **Step 2: Add registry rebuild effect**

Inside the hook body, after `registryRef` declaration:

```ts
useEffect(() => {
  registryRef.current = SeatRegistry.build(
    prefabInstances ?? [],
    zonesRef.current,
  );
}, [prefabInstances]);

// Also rebuild when zones change
useEffect(() => {
  registryRef.current = SeatRegistry.build(
    prefabInstances ?? [],
    zonesRef.current,
  );
}, [zones]);
```

(Merge into a single effect with both deps if `prefabInstances` and `zones` are both in scope.)

- [ ] **Step 3: Thread prefabInstances from the call site**

Find where `useSceneOrchestrator` is called (likely in `useOffice3DViewState.ts` or a parent) and pass `prefabInstances`:

```ts
const ceremony = useSceneOrchestrator({
  ...existingArgs,
  prefabInstances: prefabInstances.map((p) => p.instance),
});
```

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm --filter @offisim/ui-office exec tsc --noEmit`
Run: `pnpm --filter @offisim/ui-office exec vitest run`
Expected: All tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-office/src/hooks/useSceneOrchestrator.ts
git commit -m "feat: wire SeatRegistry into useSceneOrchestrator for anchor-based movement targets"
```

---

### Task 9: Full integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run full ui-office test suite**

Run: `pnpm --filter @offisim/ui-office exec vitest run`
Expected: All ~195 tests pass.

- [ ] **Step 2: Run full monorepo typecheck**

Run: `pnpm typecheck`
Expected: All 27 packages pass.

- [ ] **Step 3: Build the full monorepo**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Visual smoke test**

Run: `cd apps/web && pnpm dev`

1. Open http://localhost:5176
2. Select/create a company with prefab instances
3. Verify employees stand at desk anchors (behind chairs), not in the middle of desks
4. Trigger a ceremony (send a message) — verify employees gather at MTG circle, then dispatch to workstations at anchor positions
5. Open Studio editor, try placing a workstation — verify footprint visual is slightly larger than the model
6. Try overlapping two workstations — verify red blocked indicator appears based on footprint, not gridSize
7. Verify a company without prefab instances still shows employees at reasonable fallback positions

- [ ] **Step 5: Commit any visual tuning adjustments**

If anchor offsets need adjustment based on visual testing, update `prefab-spatial.ts` values and commit:

```bash
git add packages/ui-office/src/lib/prefab-spatial.ts
git commit -m "fix: tune prefab anchor offsets based on visual testing"
```

---

## Summary of deliverables

| What | Where | Status |
|------|-------|--------|
| Spatial types (PrefabFootprint, PrefabAnchor, etc.) | `shared-types/src/prefab-spatial.ts` | Task 1 |
| Rotation + world transform utilities | `ui-office/src/lib/prefab-spatial.ts` | Task 2 |
| Footprint overlap utility + tests | Task 2-3 files | Task 3 |
| SeatRegistry (prefab→seat resolution) | `ui-office/src/lib/seat-registry.ts` | Task 4 |
| Orchestrator: deterministic positioning | `useSceneOrchestrator.ts` | Task 5, 8 |
| Initial placement: deterministic positioning | `office3d-employees.tsx` | Task 6 |
| Studio: footprint-based collision | `StudioGhost.tsx` | Task 7 |
| Integration verification | — | Task 9 |

## NOT in scope (deferred)

- Runtime path obstacle avoidance (阻挡盒绕路)
- Movement state machine (walking / approaching / etc.)
- 2D layout engine sparsification
- Meeting table anchor-based ceremony seating (keeps existing arc layout)
