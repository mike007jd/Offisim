import type { Employee, ZoneKind } from '@/data/types.js';
import { normalizeRotation, rotateLocalXZ } from '@offisim/shared-types';
import { SCENE_CONTENT_SCALE } from './r3d/scene-art-direction.js';
import {
  WORKSTATION_DESK_DEPTH,
  WORKSTATION_DUAL_LANES,
  WORKSTATION_SEAT_FORWARD,
  WORKSTATION_SINGLE_LANES,
} from './workstation-geometry.js';

/** A resolved zone in scene coordinates, shared by the 2D and 3D office scenes
 *  so both render the same floor plan, zones, and seating from one source. */
export interface ZoneDef {
  id: string;
  label: string;
  archetype: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
}

/** Synthetic fallback layout for the no-backend case only (non-Tauri/dev
 *  preview). Both scenes fall back to this so dev/preview stays consistent
 *  across render modes. A real backend with zero zones does NOT use this —
 *  it renders an honest empty office instead. */
const FALLBACK_ZONES: ZoneDef[] = [
  {
    id: 'zone-dev',
    label: 'DEVELOPMENT',
    archetype: 'workspace',
    cx: -13.2,
    cz: 10.6,
    w: 12.4,
    d: 8.8,
  },
  {
    id: 'zone-product',
    label: 'PRODUCT',
    archetype: 'workspace',
    cx: -0.2,
    cz: 10.6,
    w: 11.2,
    d: 8.8,
  },
  {
    id: 'zone-art',
    label: 'ART & DESIGN',
    archetype: 'workspace',
    cx: 12.4,
    cz: 10.6,
    w: 11.2,
    d: 8.8,
  },
  {
    id: 'zone-library',
    label: 'LIBRARY',
    archetype: 'library',
    cx: -11.3,
    cz: 0.7,
    w: 13.2,
    d: 7.6,
  },
  { id: 'zone-rest', label: 'REST AREA', archetype: 'rest', cx: 6.3, cz: 0.7, w: 13.8, d: 7.6 },
  {
    id: 'zone-meeting',
    label: 'MEETING ROOM',
    archetype: 'meeting',
    cx: -9.4,
    cz: -8.8,
    w: 15.2,
    d: 7.4,
  },
  {
    id: 'zone-server',
    label: 'SERVER ROOM',
    archetype: 'server',
    cx: 9.4,
    cz: -8.8,
    w: 15.2,
    d: 7.4,
  },
];

interface RealZone {
  zone_id: string;
  label: string;
  archetype?: string | null;
  cx: number;
  cz: number;
  w: number;
  d: number;
}

export interface SeatAnchorPrefab {
  readonly instance: {
    readonly zone_id: string;
    readonly prefab_id: string;
    readonly position_x: number;
    readonly position_y: number;
    readonly rotation: number;
  };
  readonly definition: {
    readonly category?: string;
    readonly prefabId?: string;
  };
}

export type EmployeePosture = 'sitting' | 'standing';

export interface EmployeeScenePlacement {
  readonly x: number;
  readonly z: number;
  /** Facing angle in degrees. 0 faces +z, 180 faces -z. */
  readonly rotation: number;
  /** Sitting = parked on a workstation chair; standing = free-floor placement. */
  readonly posture: EmployeePosture;
  /** Zone the seat resolved into (assigned zone, else the fallback), so the 2D
   *  renderer can re-clamp the seat in screen space against the zone rect. */
  readonly zoneId: string;
}

interface SeatCandidate {
  readonly point: [number, number];
  readonly anchor?: SeatAnchorPrefab;
  /** Exact facing for anchored seats (chair-aligned); overrides the heuristic. */
  readonly rotation?: number;
  readonly posture?: EmployeePosture;
}

/** Build ZoneDefs from a real office layout. The synthetic fallback covers
 *  only the no-backend case (non-Tauri/dev preview, `real == null`). A real
 *  backend that genuinely has no layout (`real.zones.length === 0`) returns []
 *  so the scenes render an honest empty office instead of a fake floor plan. */
export function zoneDefsFromLayout(real: { zones: RealZone[] } | null | undefined): ZoneDef[] {
  if (!real) return FALLBACK_ZONES;
  return real.zones.map((z) => ({
    id: z.zone_id,
    label: z.label,
    archetype: z.archetype ?? 'workspace',
    cx: z.cx,
    cz: z.cz,
    w: z.w,
    d: z.d,
  }));
}

/** The zone an unassigned employee defaults into (the workspace, else first).
 *  FALLBACK_ZONES is always non-empty, so a ZoneDef is always returned. When
 *  `zoneDefs` is [] (real backend, no layout) the returned fallback is only a
 *  placeholder — employeePlacements seats nobody then, so it never renders. */
export function defaultEmployeeZone(zoneDefs: ZoneDef[]): ZoneDef {
  return (zoneDefs.find((z) => z.archetype === 'workspace') ??
    zoneDefs[0] ??
    FALLBACK_ZONES[0]) as ZoneDef;
}

const SEAT_EDGE_MARGIN = 1.25;
const EMPLOYEE_CLEARANCE_RADIUS = 0.72;
const MIN_EMPLOYEE_SPACING = 1.08;
const WORKSTATION_IDS = new Set([
  'workstation-standard',
  'workstation-compact',
  'workstation-dual',
]);

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampSeat(zone: ZoneDef, localX: number, localZ: number): [number, number] {
  const maxX = Math.max(0, zone.w / 2 - SEAT_EDGE_MARGIN);
  const maxZ = Math.max(0, zone.d / 2 - SEAT_EDGE_MARGIN);
  return [zone.cx + clamp(localX, -maxX, maxX), zone.cz + clamp(localZ, -maxZ, maxZ)];
}

function idsMatch(a: string, b: string): boolean {
  return a === b || a.endsWith(`-${b}`) || b.endsWith(`-${a}`);
}

function prefabsForZone(
  zone: ZoneDef,
  prefabs: readonly SeatAnchorPrefab[] | undefined,
): SeatAnchorPrefab[] {
  return (prefabs ?? [])
    .filter((prefab) => idsMatch(zone.id, prefab.instance.zone_id))
    .sort(
      (a, b) =>
        a.instance.position_y - b.instance.position_y ||
        a.instance.position_x - b.instance.position_x,
    );
}

/** Rotate a prefab-local (x, z) offset by a rotation in degrees. Re-exported
 *  alias of the shared-types `rotateLocalXZ` so 2D/3D seat math, collision
 *  bounds, and dramaturgy affordance anchors share one rotation source. */
export const rotateLocal = rotateLocalXZ;

function rotationToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return normalizeRotation((Math.atan2(toX - fromX, toZ - fromZ) * 180) / Math.PI);
}

function isWorkstation(prefab: SeatAnchorPrefab): boolean {
  const id = prefab.definition.prefabId ?? prefab.instance.prefab_id;
  return WORKSTATION_IDS.has(id) || prefab.definition.category === 'workspace';
}

function isFacingAnchor(prefab: SeatAnchorPrefab): boolean {
  const id = prefab.definition.prefabId ?? prefab.instance.prefab_id;
  return (
    isWorkstation(prefab) ||
    id === 'sofa-set' ||
    id === 'coffee-table' ||
    id === 'meeting-table-8' ||
    id === 'meeting-table-4' ||
    id === 'standing-table' ||
    id === 'reading-table' ||
    id === 'server-rack-4u' ||
    id === 'server-rack-2u' ||
    id === 'gpu-cluster' ||
    prefab.definition.category === 'collaboration' ||
    prefab.definition.category === 'compute'
  );
}

function obstacleRadius(prefab: SeatAnchorPrefab): number {
  const id = prefab.definition.prefabId ?? prefab.instance.prefab_id;
  switch (id) {
    case 'workstation-dual':
      return 1.75;
    case 'workstation-standard':
      return 1.58;
    case 'workstation-compact':
      return 1.35;
    case 'sofa-set':
      return 3.35;
    case 'meeting-table-8':
      return 3.45;
    case 'meeting-table-4':
      return 2.3;
    case 'standing-table':
      return 1.6;
    case 'coffee-table':
      return 1.1;
    case 'server-rack-4u':
    case 'server-rack-2u':
    case 'gpu-cluster':
      return 1.0;
    case 'bookshelf-double':
    case 'bookshelf-single':
    case 'filing-cabinet':
      return 1.2;
    case 'plant-large':
      return 0.95;
    case 'plant-small':
    case 'chair-standalone':
      return 0.72;
    default:
      if (prefab.definition.category === 'collaboration') return 2.8;
      if (prefab.definition.category === 'compute') return 1.0;
      if (prefab.definition.category === 'decorative') return 0.8;
      return 1.15;
  }
}

/** A circular obstacle footprint (world x/z + radius) for floor pathfinding. */
export interface SceneObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Project placed prefabs into circular obstacle footprints for the floor
 * pathfinder (H1/H2). Reuses the SAME `obstacleRadius` table the seat planner
 * settles seats against, so a walked route and a settled seat agree on where
 * furniture is — one obstacle source, never two. Prefab positions are stored
 * authoring coords == world coords (SCENE_CONTENT_SCALE lives on the render
 * group, not the position), matching how the seat planner reads them.
 */
export function sceneObstacles(prefabs: readonly SeatAnchorPrefab[] | undefined): SceneObstacle[] {
  return (prefabs ?? []).map((prefab) => ({
    x: prefab.instance.position_x,
    z: prefab.instance.position_y,
    radius: obstacleRadius(prefab),
  }));
}

function workstationAnchorSeats(
  count: number,
  zonePrefabs: readonly SeatAnchorPrefab[],
): SeatCandidate[] {
  const out: SeatCandidate[] = [];
  for (const prefab of zonePrefabs.filter(isWorkstation)) {
    const id = prefab.definition.prefabId ?? prefab.instance.prefab_id;
    // Chair-aligned sitting seats, anchored to the chairs WorkstationUnit3D
    // renders (constants shared via workstation-geometry). The prefab group
    // renders under SCENE_CONTENT_SCALE, so the world-space offset scales with it.
    const deskDepth =
      id === 'workstation-compact'
        ? WORKSTATION_DESK_DEPTH.compact
        : WORKSTATION_DESK_DEPTH.standard;
    const lanes = id === 'workstation-dual' ? WORKSTATION_DUAL_LANES : WORKSTATION_SINGLE_LANES;
    const forward = (deskDepth / 2 + WORKSTATION_SEAT_FORWARD) * SCENE_CONTENT_SCALE;
    const facing = normalizeRotation(prefab.instance.rotation + 180);
    for (const lane of lanes) {
      const [dx, dz] = rotateLocal(lane * SCENE_CONTENT_SCALE, forward, prefab.instance.rotation);
      out.push({
        point: [prefab.instance.position_x + dx, prefab.instance.position_y + dz],
        anchor: prefab,
        rotation: facing,
        posture: 'sitting',
      });
      if (out.length >= count) return out;
    }
  }
  return out;
}

function workspaceSeatsInZone(zone: ZoneDef, count: number): [number, number][] {
  const usableWidth = Math.max(1.6, zone.w - 3.5);
  // 2D label legibility: a seat column narrower than ~0.9 world units makes
  // name labels collide, so cap how many seats share a row. Seats spread across
  // usableWidth with (cols - 1) gaps, so cols <= floor(width / span) + 1 keeps
  // every gap >= minSeatSpan.
  const minSeatSpan = 0.9;
  const fitPerRow = Math.max(1, Math.floor(usableWidth / minSeatSpan) + 1);
  const naturalRows = count <= 3 ? 1 : count <= 8 ? 2 : 3;
  const effectivePerRow = Math.min(Math.ceil(count / naturalRows), fitPerRow);
  const rows = Math.ceil(count / effectivePerRow);
  const rowOffsets =
    rows === 1
      ? [0]
      : rows === 2
        ? [-zone.d * 0.18, zone.d * 0.23]
        : rows === 3
          ? [-zone.d * 0.28, 0, zone.d * 0.28]
          : Array.from(
              { length: rows },
              (_, row) => -zone.d * 0.3 + (row / (rows - 1)) * zone.d * 0.6,
            );
  const out: [number, number][] = [];

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / effectivePerRow);
    const col = i % effectivePerRow;
    const colsInRow = Math.min(effectivePerRow, count - row * effectivePerRow);
    const x =
      colsInRow === 1 ? 0 : -usableWidth / 2 + (col / Math.max(1, colsInRow - 1)) * usableWidth;
    const stagger = rows > 1 && row % 2 === 1 ? Math.min(0.7, usableWidth / 12) : 0;
    out.push(clampSeat(zone, x + stagger, rowOffsets[row] ?? 0));
  }

  return out;
}

function loungeSeatsInZone(zone: ZoneDef, count: number): [number, number][] {
  const columns = Math.ceil(count / 2);
  const usableWidth = Math.max(1.8, zone.w - 4.4);
  const out: [number, number][] = [];

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const colsInRow = Math.min(columns, count - row * columns);
    const x =
      colsInRow === 1 ? 0 : -usableWidth / 2 + (col / Math.max(1, colsInRow - 1)) * usableWidth;
    const z = row === 0 ? zone.d * 0.33 : -zone.d * 0.32;
    out.push(clampSeat(zone, x, z));
  }

  return out;
}

function radialSeatsInZone(
  zone: ZoneDef,
  count: number,
  radiusX: number,
  radiusZ: number,
  startAngle: number,
  arc: number,
): [number, number][] {
  if (count <= 0) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = count === 1 ? 0.5 : i / (count - 1);
    const angle = startAngle + ratio * arc;
    out.push(clampSeat(zone, Math.cos(angle) * radiusX, Math.sin(angle) * radiusZ));
  }
  return out;
}

function perimeterSeatsInZone(zone: ZoneDef, count: number): [number, number][] {
  const usableWidth = Math.max(1.4, zone.w - 3);
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = count === 1 ? 0.5 : i / (count - 1);
    const x = -usableWidth / 2 + ratio * usableWidth;
    const z = zone.d * (i % 2 === 0 ? 0.23 : 0.08);
    out.push(clampSeat(zone, x, z));
  }
  return out;
}

function nudgeSeatAwayFromObstacles(
  zone: ZoneDef,
  seat: [number, number],
  obstacles: readonly {
    x: number;
    z: number;
    radius: number;
    prefab: SeatAnchorPrefab;
  }[],
  ignoredPrefab: SeatAnchorPrefab | undefined,
  seed: number,
): [number, number] {
  let [x, z] = seat;
  for (let pass = 0; pass < 5; pass += 1) {
    for (const obstacle of obstacles) {
      if (obstacle.prefab === ignoredPrefab) continue;
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      const distance = Math.hypot(dx, dz);
      const minDistance = obstacle.radius + EMPLOYEE_CLEARANCE_RADIUS;
      if (distance >= minDistance) continue;

      const angle =
        distance > 0.001 ? Math.atan2(dz, dx) : seed * 2.399963229728653 + zone.cx + zone.cz;
      const push = minDistance - distance + 0.22;
      x += Math.cos(angle) * push;
      z += Math.sin(angle) * push;
      [x, z] = clampSeat(zone, x - zone.cx, z - zone.cz);
    }
  }
  return [x, z];
}

function settleSeats(
  zone: ZoneDef,
  seats: readonly SeatCandidate[],
  zonePrefabs: readonly SeatAnchorPrefab[],
): [number, number][] {
  const obstacles = zonePrefabs.map((prefab) => ({
    x: prefab.instance.position_x,
    z: prefab.instance.position_y,
    radius: obstacleRadius(prefab),
    prefab,
  }));
  const out: [number, number][] = [];

  seats.forEach((seat, index) => {
    // Chair-anchored sitting seats are exact by construction — settling them
    // away from the chair would leave the character hovering beside it.
    if (seat.posture === 'sitting') {
      out.push(seat.point);
      return;
    }
    let next = nudgeSeatAwayFromObstacles(zone, seat.point, obstacles, seat.anchor, index + 1);
    for (let pass = 0; pass < 3; pass += 1) {
      for (const previous of out) {
        const dx = next[0] - previous[0];
        const dz = next[1] - previous[1];
        const distance = Math.hypot(dx, dz);
        if (distance >= MIN_EMPLOYEE_SPACING) continue;
        const angle =
          distance > 0.001 ? Math.atan2(dz, dx) : (index + pass + 1) * 2.399963229728653;
        next = clampSeat(
          zone,
          next[0] - zone.cx + Math.cos(angle) * (MIN_EMPLOYEE_SPACING - distance + 0.16),
          next[1] - zone.cz + Math.sin(angle) * (MIN_EMPLOYEE_SPACING - distance + 0.16),
        );
        next = nudgeSeatAwayFromObstacles(zone, next, obstacles, seat.anchor, index + pass + 1);
      }
    }
    out.push(next);
  });

  return out;
}

function placementRotation(
  zone: ZoneDef,
  seat: [number, number],
  zonePrefabs: readonly SeatAnchorPrefab[],
): number {
  let nearest: SeatAnchorPrefab | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const prefab of zonePrefabs) {
    if (!isFacingAnchor(prefab)) continue;
    const distance = Math.hypot(
      seat[0] - prefab.instance.position_x,
      seat[1] - prefab.instance.position_y,
    );
    if (distance < nearestDistance) {
      nearest = prefab;
      nearestDistance = distance;
    }
  }

  if (nearest && nearestDistance < obstacleRadius(nearest) + 2.8) {
    return rotationToward(
      seat[0],
      seat[1],
      nearest.instance.position_x,
      nearest.instance.position_y,
    );
  }

  return rotationToward(seat[0], seat[1], zone.cx, zone.cz);
}

function mergedSeats(
  zone: ZoneDef,
  count: number,
  anchored: readonly SeatCandidate[],
): SeatCandidate[] {
  const fallback = seatsInZone(zone, count);
  const out = [...anchored];
  for (const seat of fallback) {
    if (out.length >= count) break;
    if (out.every(({ point: [x, z] }) => Math.hypot(x - seat[0], z - seat[1]) > 0.7)) {
      out.push({ point: seat });
    }
  }
  while (out.length < count) {
    out.push({ point: fallback[out.length % Math.max(1, fallback.length)] ?? [zone.cx, zone.cz] });
  }
  return out.slice(0, count);
}

function seatsInZone(zone: ZoneDef, count: number): [number, number][] {
  if (count <= 0) return [];
  if (zone.archetype === 'meeting') {
    return radialSeatsInZone(
      zone,
      count,
      zone.w * 0.3,
      zone.d * 0.28,
      Math.PI * 0.12,
      Math.PI * 0.76,
    );
  }
  if (zone.archetype === 'rest' || zone.archetype === 'lounge') {
    return loungeSeatsInZone(zone, count);
  }
  if (zone.archetype === 'library' || zone.archetype === 'server') {
    return perimeterSeatsInZone(zone, count);
  }
  return workspaceSeatsInZone(zone, count);
}

function employeeZone(employee: Employee, zones: ZoneDef[], fallbackZone: ZoneDef): ZoneDef {
  return zones.find((zone) => zone.id === employee.workstationId) ?? fallbackZone;
}

/** Deterministic 3D placement per employee, grouped by their assigned zone. */
export function employeePlacements(
  roster: Employee[],
  zones: ZoneDef[],
  fallbackZone: ZoneDef,
  prefabs?: readonly SeatAnchorPrefab[],
): Map<string, EmployeeScenePlacement> {
  // A real backend with no layout has no zones to seat anyone in: place no
  // one, rather than parking the roster in a synthetic placeholder zone.
  if (zones.length === 0) return new Map();
  const byZone = new Map<string, { zone: ZoneDef; employees: Employee[] }>();
  for (const employee of roster) {
    const zone = employeeZone(employee, zones, fallbackZone);
    const group = byZone.get(zone.id) ?? { zone, employees: [] };
    group.employees.push(employee);
    byZone.set(zone.id, group);
  }

  const placements = new Map<string, EmployeeScenePlacement>();
  for (const { zone, employees } of byZone.values()) {
    const zonePrefabs = prefabsForZone(zone, prefabs);
    const anchored = workstationAnchorSeats(employees.length, zonePrefabs);
    const candidates = mergedSeats(zone, employees.length, anchored);
    const seats = settleSeats(zone, candidates, zonePrefabs);
    employees.forEach((employee, index) => {
      const seat = seats[index] ?? [zone.cx, zone.cz];
      const candidate = candidates[index];
      placements.set(employee.id, {
        x: seat[0],
        z: seat[1],
        rotation: candidate?.rotation ?? placementRotation(zone, seat, zonePrefabs),
        posture: candidate?.posture ?? 'standing',
        zoneId: zone.id,
      });
    });
  }
  return placements;
}

/** Floor extent (origin-centered) that bounds every zone plus a margin, used by
 *  the 2D top-down scene to scale the real layout to the canvas. */
export function floorBounds(zoneDefs: ZoneDef[]): { floorW: number; floorD: number } {
  if (zoneDefs.length === 0) return { floorW: 32, floorD: 28 };
  let maxX = 0;
  let maxZ = 0;
  for (const z of zoneDefs) {
    maxX = Math.max(maxX, Math.abs(z.cx) + z.w / 2);
    maxZ = Math.max(maxZ, Math.abs(z.cz) + z.d / 2);
  }
  const margin = 2;
  return { floorW: maxX * 2 + margin * 2, floorD: maxZ * 2 + margin * 2 };
}

/** Map a zone archetype onto the 2D top-down tint key (workspace/meeting/lounge). */
export function archetypeToKind(archetype: string): ZoneKind {
  if (archetype === 'meeting') return 'meeting';
  if (archetype === 'rest' || archetype === 'lounge') return 'lounge';
  return 'workspace';
}
