import type {
  PrefabAnchor,
  PrefabInstanceRow,
  PrefabSpatialSpec,
  Zone,
} from '@offisim/shared-types';
import {
  type WorldFootprint,
  getSpatialSpec,
  rotateLocalPoint,
  toWorldAnchor,
  toWorldFootprint,
} from './prefab-spatial';
import { SEAT_OFFSETS } from './seat-offsets';

const REST_SEAT_TARGET_COUNT = 18;
const SEAT_CLEARANCE = 0.05;
const MIN_SEAT_SPACING = 0.75;

/**
 * Deterministic circular layout for rest-area seating.
 * Shared by SeatRegistry and fallback paths.
 */
export function computeRestSeatPosition(
  cx: number,
  cz: number,
  slotIndex: number,
): [number, number, number] {
  const totalSlots = Math.max(slotIndex + 1, 6);
  const angle = (slotIndex / totalSlots) * Math.PI * 1.5 + 0.3;
  const radius = 1.2 + (slotIndex % 3) * 0.8;
  return [cx + Math.cos(angle) * radius, 0, cz + Math.sin(angle) * radius];
}

export interface SeatEntry {
  readonly position: [number, number, number];
  readonly facing: number;
  readonly instanceId: string | null;
  readonly isFallback: boolean;
}

function ensureOutsideFootprint(
  position: readonly [number, number, number],
  footprint: WorldFootprint,
  facing: number,
): [number, number, number] {
  const dx = position[0] - footprint.cx;
  const dz = position[2] - footprint.cz;
  const insideX = Math.abs(dx) < footprint.halfW + SEAT_CLEARANCE;
  const insideZ = Math.abs(dz) < footprint.halfD + SEAT_CLEARANCE;
  if (!insideX || !insideZ) {
    return [position[0], position[1], position[2]];
  }

  let outX = position[0];
  let outZ = position[2];
  if (Math.abs(dx) > Math.abs(dz)) {
    const sign = dx === 0 ? Math.sin(facing) || 1 : Math.sign(dx);
    outX = footprint.cx + sign * (footprint.halfW + SEAT_CLEARANCE);
  } else {
    const sign = dz === 0 ? Math.cos(facing) || 1 : Math.sign(dz);
    outZ = footprint.cz + sign * (footprint.halfD + SEAT_CLEARANCE);
  }
  return [outX, position[1], outZ];
}

function isBlockedByFootprint(
  x: number,
  z: number,
  footprints: readonly (WorldFootprint & { readonly instanceId?: string })[],
  ignoreInstanceId?: string | null,
) {
  return footprints.some((footprint) => {
    if (ignoreInstanceId && footprint.instanceId === ignoreInstanceId) {
      return false;
    }
    return (
      Math.abs(x - footprint.cx) < footprint.halfW + SEAT_CLEARANCE &&
      Math.abs(z - footprint.cz) < footprint.halfD + SEAT_CLEARANCE
    );
  });
}

function isTooCloseToExisting(
  position: readonly [number, number, number],
  existingSeats: readonly SeatEntry[],
): boolean {
  return existingSeats.some((seat) => {
    const dx = seat.position[0] - position[0];
    const dz = seat.position[2] - position[2];
    return dx * dx + dz * dz < MIN_SEAT_SPACING * MIN_SEAT_SPACING;
  });
}

function buildAnchoredSeats(
  spec: PrefabSpatialSpec,
  inst: PrefabInstanceRow,
  anchor: PrefabAnchor,
): SeatEntry[] {
  const worldOrigin: readonly [number, number] = [inst.position_x, inst.position_y];
  const footprint = toWorldFootprint(spec.footprint, worldOrigin, inst.rotation);
  const base = toWorldAnchor(anchor, worldOrigin, inst.rotation);
  const seats: SeatEntry[] = [];

  const pushSeat = (position: readonly [number, number, number]) => {
    seats.push({
      position: ensureOutsideFootprint(position, footprint, base.facing),
      facing: base.facing,
      instanceId: inst.instance_id,
      isFallback: false,
    });
  };

  if (spec.capacity <= 1) {
    pushSeat(base.position);
    return seats;
  }

  for (let i = 0; i < spec.capacity; i++) {
    const lateralOffset = (i - (spec.capacity - 1) / 2) * 0.8;
    const [offsetX, offsetZ] = rotateLocalPoint([lateralOffset, 0], inst.rotation);
    pushSeat([base.position[0] + offsetX, base.position[1], base.position[2] + offsetZ]);
  }

  return seats;
}

function buildFallbackZoneSeat(
  zone: Zone,
  slotIndex: number,
  footprints: readonly WorldFootprint[],
  existingSeats: readonly SeatEntry[],
): SeatEntry {
  const offsetIdx = slotIndex % SEAT_OFFSETS.length;
  const rowShift = Math.floor(slotIndex / SEAT_OFFSETS.length) * 2;
  const offset = SEAT_OFFSETS[offsetIdx] ?? SEAT_OFFSETS[0] ?? [0, 0, 0];
  let position: [number, number, number] = [zone.cx + offset[0], 0, zone.cz + offset[2] + rowShift];

  if (
    isBlockedByFootprint(position[0], position[2], footprints) ||
    isTooCloseToExisting(position, existingSeats)
  ) {
    for (let candidate = slotIndex; candidate < slotIndex + 24; candidate++) {
      const candidateOffsetIdx = candidate % SEAT_OFFSETS.length;
      const candidateRowShift = Math.floor(candidate / SEAT_OFFSETS.length) * 2;
      const candidateOffset = SEAT_OFFSETS[candidateOffsetIdx] ?? SEAT_OFFSETS[0] ?? [0, 0, 0];
      const candidatePosition: [number, number, number] = [
        zone.cx + candidateOffset[0],
        0,
        zone.cz + candidateOffset[2] + candidateRowShift,
      ];
      if (
        !isBlockedByFootprint(candidatePosition[0], candidatePosition[2], footprints) &&
        !isTooCloseToExisting(candidatePosition, existingSeats)
      ) {
        position = candidatePosition;
        break;
      }
    }
  }

  return {
    position,
    facing: Math.PI,
    instanceId: null,
    isFallback: true,
  };
}

function buildRestFallbackSeats(
  zone: Zone,
  targetCount: number,
  footprints: readonly WorldFootprint[],
  existingSeats: readonly SeatEntry[],
): SeatEntry[] {
  const fallbackSeats: SeatEntry[] = [];
  for (
    let candidate = 0;
    fallbackSeats.length < targetCount && candidate < targetCount * 8;
    candidate++
  ) {
    const position = computeRestSeatPosition(zone.cx, zone.cz, candidate);
    if (
      isBlockedByFootprint(position[0], position[2], footprints) ||
      isTooCloseToExisting(position, [...existingSeats, ...fallbackSeats])
    ) {
      continue;
    }
    fallbackSeats.push({
      position,
      facing: Math.PI,
      instanceId: null,
      isFallback: true,
    });
  }
  return fallbackSeats;
}

interface ZoneFootprint extends WorldFootprint {
  readonly instanceId: string;
}

export class SeatRegistry {
  private readonly seats: ReadonlyMap<string, readonly SeatEntry[]>;
  private readonly restSeats: ReadonlyMap<string, readonly SeatEntry[]>;
  private readonly obstacleFootprintsByZone: ReadonlyMap<string, readonly ZoneFootprint[]>;
  private readonly allObstacleFootprints: readonly WorldFootprint[];

  private constructor(
    seats: Map<string, SeatEntry[]>,
    restSeats: Map<string, SeatEntry[]>,
    obstacleFootprints: Map<string, ZoneFootprint[]>,
  ) {
    this.seats = seats;
    this.restSeats = restSeats;
    this.obstacleFootprintsByZone = obstacleFootprints;
    this.allObstacleFootprints = [...obstacleFootprints.values()].flat();
  }

  static build(instances: readonly PrefabInstanceRow[], zones: readonly Zone[]): SeatRegistry {
    const seats = new Map<string, SeatEntry[]>();
    const restSeats = new Map<string, SeatEntry[]>();
    const zoneById = new Map(zones.map((zone) => [zone.zoneId, zone]));
    const zoneFootprints = new Map<string, ZoneFootprint[]>();

    const getZoneFootprints = (zoneId: string) => {
      const existing = zoneFootprints.get(zoneId);
      if (existing) return existing;
      const next: ZoneFootprint[] = [];
      zoneFootprints.set(zoneId, next);
      return next;
    };

    const getZoneSeats = (zoneId: string) => {
      const existing = seats.get(zoneId);
      if (existing) return existing;
      const next: SeatEntry[] = [];
      seats.set(zoneId, next);
      return next;
    };

    const getRestZoneSeats = (zoneId: string) => {
      const existing = restSeats.get(zoneId);
      if (existing) return existing;
      const next: SeatEntry[] = [];
      restSeats.set(zoneId, next);
      return next;
    };

    // Phase 1: collect footprints and anchor-derived seats from prefab instances.
    for (const inst of instances) {
      if (!inst.enabled) continue;

      const spec = getSpatialSpec(inst.prefab_id);
      if (!spec) continue;

      const worldOrigin: readonly [number, number] = [inst.position_x, inst.position_y];
      getZoneFootprints(inst.zone_id).push({
        ...toWorldFootprint(spec.footprint, worldOrigin, inst.rotation),
        instanceId: inst.instance_id,
      });

      if (spec.capacity === 0) continue;

      const zone = zoneById.get(inst.zone_id);
      const targetSeats =
        zone?.archetype === 'rest' ? getRestZoneSeats(inst.zone_id) : getZoneSeats(inst.zone_id);
      const anchor =
        zone?.archetype === 'rest'
          ? (spec.anchors.stand ?? spec.anchors.approach ?? spec.anchors.work)
          : spec.anchors.work;

      targetSeats.push(...buildAnchoredSeats(spec, inst, anchor));
    }

    // Phase 2: fill workspace fallback seats for zones that need more capacity.
    for (const zone of zones) {
      if (zone.deskSlots <= 0 || zone.archetype === 'rest') continue;

      const zoneSeats = getZoneSeats(zone.zoneId);
      const zoneObstacleFootprints = getZoneFootprints(zone.zoneId);
      const needed = zone.deskSlots - zoneSeats.length;
      if (needed <= 0) continue;

      for (let slotIndex = 0; slotIndex < needed; slotIndex++) {
        zoneSeats.push(
          buildFallbackZoneSeat(zone, zoneSeats.length, zoneObstacleFootprints, zoneSeats),
        );
      }
    }

    // Phase 3: precompute a richer rest-seat pool so idle employees spread and avoid furniture.
    for (const zone of zones) {
      if (zone.archetype !== 'rest') continue;
      const zoneSeats = getRestZoneSeats(zone.zoneId);
      const zoneObstacleFootprints = getZoneFootprints(zone.zoneId);
      const targetCount = Math.max(zone.deskSlots || 0, REST_SEAT_TARGET_COUNT);
      if (zoneSeats.length < targetCount) {
        zoneSeats.push(
          ...buildRestFallbackSeats(
            zone,
            targetCount - zoneSeats.length,
            zoneObstacleFootprints,
            zoneSeats,
          ),
        );
      }
    }

    return new SeatRegistry(seats, restSeats, zoneFootprints);
  }

  getSeat(zoneId: string, slotIndex: number): SeatEntry | null {
    const zoneSeats = this.seats.get(zoneId);
    if (!zoneSeats || zoneSeats.length === 0) return null;
    return zoneSeats[slotIndex % zoneSeats.length] ?? null;
  }

  getZoneSeats(zoneId: string): readonly SeatEntry[] {
    return this.seats.get(zoneId) ?? [];
  }

  getRestSeat(zones: readonly Zone[], slotIndex: number): [number, number, number] {
    const restZone = zones.find((z) => z.archetype === 'rest');
    const seatPool = restZone ? this.restSeats.get(restZone.zoneId) : undefined;
    if (seatPool && seatPool.length > 0) {
      const seat = seatPool[slotIndex % seatPool.length] ?? seatPool[0];
      return seat ? [...seat.position] : computeRestSeatPosition(0, 0, slotIndex);
    }
    return computeRestSeatPosition(restZone?.cx ?? 0, restZone?.cz ?? 0, slotIndex);
  }

  getObstacleFootprints(zoneId?: string): readonly WorldFootprint[] {
    if (zoneId) {
      return this.obstacleFootprintsByZone.get(zoneId) ?? [];
    }
    return this.allObstacleFootprints;
  }
}
