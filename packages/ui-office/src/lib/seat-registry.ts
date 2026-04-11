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
const SEAT_CLEARANCE = 0.55;
const MIN_SEAT_SPACING = 0.75;
const MIN_APPROACH_LEAD = 0.35;

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

export function computeWorkspaceFallbackSeatPosition(
  cx: number,
  cz: number,
  slotIndex: number,
): [number, number, number] {
  const offsetIdx = slotIndex % SEAT_OFFSETS.length;
  const rowShift = Math.floor(slotIndex / SEAT_OFFSETS.length) * 2;
  const offset = SEAT_OFFSETS[offsetIdx] ?? SEAT_OFFSETS[0] ?? [0, 0, 0];
  return [cx + offset[0], 0, cz + offset[2] + rowShift];
}

export interface SeatEntry {
  readonly position: [number, number, number];
  readonly approachPosition: [number, number, number];
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

function distance2D(a: readonly [number, number, number], b: readonly [number, number, number]) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

interface ZoneFootprint extends WorldFootprint {
  readonly instanceId: string;
}

function isBlockedByFootprint(
  x: number,
  z: number,
  footprints: readonly ZoneFootprint[],
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
  approachAnchor: PrefabAnchor,
  zoneFootprints: readonly ZoneFootprint[] = [],
): SeatEntry[] {
  const worldOrigin: readonly [number, number] = [inst.position_x, inst.position_y];
  const footprint = toWorldFootprint(spec.footprint, worldOrigin, inst.rotation);
  const base = toWorldAnchor(anchor, worldOrigin, inst.rotation);
  const approachBase = toWorldAnchor(approachAnchor, worldOrigin, inst.rotation);
  const seats: SeatEntry[] = [];

  const pushSeat = (
    position: readonly [number, number, number],
    approachPosition: readonly [number, number, number],
  ) => {
    const resolvedPosition = ensureOutsideFootprint(position, footprint, base.facing);
    let resolvedApproach = ensureOutsideFootprint(approachPosition, footprint, approachBase.facing);
    if (distance2D(resolvedPosition, resolvedApproach) < MIN_APPROACH_LEAD) {
      const rawDx = approachPosition[0] - position[0];
      const rawDz = approachPosition[2] - position[2];
      const rawLength = Math.hypot(rawDx, rawDz);
      const fallbackAngle = approachBase.facing + Math.PI;
      const dirX = rawLength > 1e-6 ? rawDx / rawLength : Math.cos(fallbackAngle);
      const dirZ = rawLength > 1e-6 ? rawDz / rawLength : Math.sin(fallbackAngle);
      resolvedApproach = ensureOutsideFootprint(
        [
          resolvedPosition[0] + dirX * MIN_APPROACH_LEAD,
          resolvedPosition[1],
          resolvedPosition[2] + dirZ * MIN_APPROACH_LEAD,
        ],
        footprint,
        approachBase.facing,
      );
    }

    // Drop seats that land inside another furniture instance's footprint in
    // the same zone. Fallback / overflow seat builders will fill the slot.
    if (
      isBlockedByFootprint(
        resolvedPosition[0],
        resolvedPosition[2],
        zoneFootprints,
        inst.instance_id,
      )
    ) {
      return;
    }

    seats.push({
      position: resolvedPosition,
      approachPosition: resolvedApproach,
      facing: base.facing,
      instanceId: inst.instance_id,
      isFallback: false,
    });
  };

  if (spec.capacity <= 1) {
    pushSeat(base.position, approachBase.position);
    return seats;
  }

  for (let i = 0; i < spec.capacity; i++) {
    const lateralOffset = (i - (spec.capacity - 1) / 2) * 0.8;
    const [offsetX, offsetZ] = rotateLocalPoint([lateralOffset, 0], inst.rotation);
    pushSeat(
      [base.position[0] + offsetX, base.position[1], base.position[2] + offsetZ],
      [
        approachBase.position[0] + offsetX,
        approachBase.position[1],
        approachBase.position[2] + offsetZ,
      ],
    );
  }

  return seats;
}

function buildFallbackZoneSeat(
  zone: Zone,
  slotIndex: number,
  footprints: readonly ZoneFootprint[],
  existingSeats: readonly SeatEntry[],
): SeatEntry {
  let position = computeWorkspaceFallbackSeatPosition(zone.cx, zone.cz, slotIndex);

  if (
    isBlockedByFootprint(position[0], position[2], footprints) ||
    isTooCloseToExisting(position, existingSeats)
  ) {
    for (let candidate = slotIndex; candidate < slotIndex + 24; candidate++) {
      const candidatePosition = computeWorkspaceFallbackSeatPosition(zone.cx, zone.cz, candidate);
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
    approachPosition: position,
    facing: Math.PI,
    instanceId: null,
    isFallback: true,
  };
}

function buildRestFallbackSeats(
  zone: Zone,
  targetCount: number,
  footprints: readonly ZoneFootprint[],
  existingSeats: readonly SeatEntry[],
  candidateStart = 0,
): SeatEntry[] {
  const fallbackSeats: SeatEntry[] = [];
  for (
    let candidate = candidateStart;
    fallbackSeats.length < targetCount &&
    candidate < candidateStart + Math.max(targetCount * 8, 64);
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
      approachPosition: position,
      facing: Math.PI,
      instanceId: null,
      isFallback: true,
    });
  }
  return fallbackSeats;
}

function buildOverflowRestSeat(
  zone: Zone,
  seedIndex: number,
  footprints: readonly ZoneFootprint[],
  existingSeats: readonly SeatEntry[],
): SeatEntry {
  for (let attempt = 0; attempt < 256; attempt++) {
    const candidateIndex = seedIndex + attempt;
    const ring = Math.floor(candidateIndex / 12);
    const angle = ((candidateIndex % 12) / 12) * Math.PI * 2 + (ring % 2 === 0 ? 0 : Math.PI / 12);
    const radius = 1.6 + ring * MIN_SEAT_SPACING;
    const position: [number, number, number] = [
      zone.cx + Math.cos(angle) * radius,
      0,
      zone.cz + Math.sin(angle) * radius,
    ];

    if (
      isBlockedByFootprint(position[0], position[2], footprints) ||
      isTooCloseToExisting(position, existingSeats)
    ) {
      continue;
    }

    return {
      position,
      approachPosition: position,
      facing: Math.PI,
      instanceId: null,
      isFallback: true,
    };
  }

  const position = computeRestSeatPosition(zone.cx, zone.cz, seedIndex);
  return {
    position,
    approachPosition: position,
    facing: Math.PI,
    instanceId: null,
    isFallback: true,
  };
}

export class SeatRegistry {
  private readonly seats: ReadonlyMap<string, readonly SeatEntry[]>;
  private readonly restSeats: ReadonlyMap<string, readonly SeatEntry[]>;
  private readonly obstacleFootprintsByZone: ReadonlyMap<string, readonly ZoneFootprint[]>;
  private readonly allObstacleFootprints: readonly WorldFootprint[];
  private readonly zonesById: ReadonlyMap<string, Zone>;
  private readonly overflowSeatsByZone = new Map<string, SeatEntry[]>();
  private readonly overflowRestSeatsByZone = new Map<string, SeatEntry[]>();

  private constructor(
    seats: Map<string, SeatEntry[]>,
    restSeats: Map<string, SeatEntry[]>,
    obstacleFootprints: Map<string, ZoneFootprint[]>,
    zonesById: Map<string, Zone>,
  ) {
    this.seats = seats;
    this.restSeats = restSeats;
    this.obstacleFootprintsByZone = obstacleFootprints;
    this.allObstacleFootprints = [...obstacleFootprints.values()].flat();
    this.zonesById = zonesById;
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

    // Phase 1a: collect every footprint first, so Phase 1b can see all
    // neighbors when deciding whether to keep an anchored seat.
    for (const inst of instances) {
      if (!inst.enabled) continue;

      const spec = getSpatialSpec(inst.prefab_id);
      if (!spec) continue;

      const worldOrigin: readonly [number, number] = [inst.position_x, inst.position_y];
      getZoneFootprints(inst.zone_id).push({
        ...toWorldFootprint(spec.footprint, worldOrigin, inst.rotation),
        instanceId: inst.instance_id,
      });
    }

    // Phase 1b: build anchored seats with full neighbor footprint awareness.
    // Seats inside another furniture's footprint are dropped here; the rest
    // of the pipeline (workspace fallback / rest fallback / overflow) will
    // refill the missing slots.
    for (const inst of instances) {
      if (!inst.enabled) continue;

      const spec = getSpatialSpec(inst.prefab_id);
      if (!spec) continue;
      if (spec.capacity === 0) continue;

      const zone = zoneById.get(inst.zone_id);
      const zoneFootprintList = getZoneFootprints(inst.zone_id);
      const targetSeats =
        zone?.archetype === 'rest' ? getRestZoneSeats(inst.zone_id) : getZoneSeats(inst.zone_id);
      if (zone?.archetype === 'rest') {
        const restAnchor = spec.anchors.stand ?? spec.anchors.approach ?? spec.anchors.work;
        targetSeats.push(
          ...buildAnchoredSeats(spec, inst, restAnchor, restAnchor, zoneFootprintList),
        );
      } else {
        targetSeats.push(
          ...buildAnchoredSeats(
            spec,
            inst,
            spec.anchors.work,
            spec.anchors.approach ?? spec.anchors.work,
            zoneFootprintList,
          ),
        );
      }
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

    return new SeatRegistry(seats, restSeats, zoneFootprints, zoneById);
  }

  getSeat(zoneId: string, slotIndex: number): SeatEntry | null {
    const zoneSeats = this.seats.get(zoneId);
    if (zoneSeats && slotIndex < zoneSeats.length) {
      return zoneSeats[slotIndex] ?? null;
    }

    const zone = this.zonesById.get(zoneId);
    if (!zone) return null;

    const overflowSeats = this.ensureOverflowSeats(zoneId, zone, slotIndex + 1);
    const overflowIndex = slotIndex - (zoneSeats?.length ?? 0);
    return overflowSeats[overflowIndex] ?? null;
  }

  getZoneSeats(zoneId: string): readonly SeatEntry[] {
    return this.seats.get(zoneId) ?? [];
  }

  getRestSeat(zones: readonly Zone[], slotIndex: number): [number, number, number] {
    const restZone = zones.find((z) => z.archetype === 'rest');
    const seatPool = restZone ? this.restSeats.get(restZone.zoneId) : undefined;
    if (restZone && seatPool && slotIndex < seatPool.length) {
      const seat = seatPool[slotIndex];
      return seat
        ? [...seat.position]
        : computeRestSeatPosition(restZone.cx, restZone.cz, slotIndex);
    }
    if (restZone) {
      const overflowSeats = this.ensureOverflowRestSeats(restZone.zoneId, restZone, slotIndex + 1);
      const overflowIndex = slotIndex - (seatPool?.length ?? 0);
      const seat = overflowSeats[overflowIndex];
      if (seat) return [...seat.position];
    }
    return computeRestSeatPosition(restZone?.cx ?? 0, restZone?.cz ?? 0, slotIndex);
  }

  getObstacleFootprints(zoneId?: string): readonly WorldFootprint[] {
    if (zoneId) {
      return this.obstacleFootprintsByZone.get(zoneId) ?? [];
    }
    return this.allObstacleFootprints;
  }

  private ensureOverflowSeats(zoneId: string, zone: Zone, targetCount: number): SeatEntry[] {
    const baseSeats = [...(this.seats.get(zoneId) ?? [])];
    const overflowSeats = this.overflowSeatsByZone.get(zoneId) ?? [];
    const zoneObstacleFootprints = this.obstacleFootprintsByZone.get(zoneId) ?? [];

    while (baseSeats.length + overflowSeats.length < targetCount) {
      const nextSeat = buildFallbackZoneSeat(
        zone,
        baseSeats.length + overflowSeats.length,
        zoneObstacleFootprints,
        [...baseSeats, ...overflowSeats],
      );
      overflowSeats.push(nextSeat);
    }

    this.overflowSeatsByZone.set(zoneId, overflowSeats);
    return overflowSeats;
  }

  private ensureOverflowRestSeats(zoneId: string, zone: Zone, targetCount: number): SeatEntry[] {
    const baseSeats = [...(this.restSeats.get(zoneId) ?? [])];
    const overflowSeats = this.overflowRestSeatsByZone.get(zoneId) ?? [];
    const zoneObstacleFootprints = this.obstacleFootprintsByZone.get(zoneId) ?? [];

    while (baseSeats.length + overflowSeats.length < targetCount) {
      const nextSeat = buildOverflowRestSeat(
        zone,
        baseSeats.length + overflowSeats.length,
        zoneObstacleFootprints,
        [...baseSeats, ...overflowSeats],
      );
      overflowSeats.push(nextSeat);
    }

    this.overflowRestSeatsByZone.set(zoneId, overflowSeats);
    return overflowSeats;
  }
}
