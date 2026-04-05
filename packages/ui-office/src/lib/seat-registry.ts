import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { SEAT_OFFSETS } from './seat-offsets';
import { getSpatialSpec, toWorldAnchor } from './prefab-spatial';

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

export class SeatRegistry {
  private readonly seats: ReadonlyMap<string, readonly SeatEntry[]>;

  private constructor(seats: Map<string, SeatEntry[]>) {
    this.seats = seats;
  }

  static build(
    instances: readonly PrefabInstanceRow[],
    zones: readonly Zone[],
  ): SeatRegistry {
    const seats = new Map<string, SeatEntry[]>();

    // Phase 1: collect seats from prefab instances
    for (const inst of instances) {
      if (!inst.enabled) continue;

      const spec = getSpatialSpec(inst.prefab_id);
      if (!spec || spec.capacity === 0) continue;

      const workAnchor = spec.anchors.work;
      const worldOrigin: readonly [number, number] = [
        inst.position_x,
        inst.position_y,
      ];

      if (!seats.has(inst.zone_id)) {
        seats.set(inst.zone_id, []);
      }
      const zoneSeats = seats.get(inst.zone_id)!;

      if (spec.capacity === 1) {
        const world = toWorldAnchor(workAnchor, worldOrigin, inst.rotation);
        zoneSeats.push({
          position: world.position,
          facing: world.facing,
          instanceId: inst.instance_id,
          isFallback: false,
        });
      } else {
        // Multi-capacity: spread seats around the work anchor
        const base = toWorldAnchor(workAnchor, worldOrigin, inst.rotation);
        for (let i = 0; i < spec.capacity; i++) {
          const offset = (i - (spec.capacity - 1) / 2) * 0.8;
          zoneSeats.push({
            position: [
              base.position[0] + offset,
              base.position[1],
              base.position[2],
            ],
            facing: base.facing,
            instanceId: inst.instance_id,
            isFallback: false,
          });
        }
      }

    }

    // Phase 2: fill fallback seats for zones that need more capacity
    // A zone may have SOME prefab seats but fewer than deskSlots —
    // we must fill the gap instead of skipping the whole zone.
    for (const zone of zones) {
      if (zone.deskSlots <= 0) continue;

      if (!seats.has(zone.zoneId)) seats.set(zone.zoneId, []);
      const zoneSeats = seats.get(zone.zoneId)!;
      const needed = zone.deskSlots - zoneSeats.length;
      if (needed <= 0) continue;

      const base = zoneSeats.length;
      for (let i = 0; i < needed; i++) {
        const offsetIdx = (base + i) % SEAT_OFFSETS.length;
        const rowShift = Math.floor((base + i) / SEAT_OFFSETS.length) * 2;
        const off = SEAT_OFFSETS[offsetIdx]!;
        zoneSeats.push({
          position: [zone.cx + off[0], 0, zone.cz + off[2] + rowShift],
          facing: Math.PI,
          instanceId: null,
          isFallback: true,
        });
      }
    }

    return new SeatRegistry(seats);
  }

  getSeat(zoneId: string, slotIndex: number): SeatEntry | null {
    const zoneSeats = this.seats.get(zoneId);
    if (!zoneSeats || zoneSeats.length === 0) return null;
    return zoneSeats[slotIndex % zoneSeats.length]!;
  }

  getZoneSeats(zoneId: string): readonly SeatEntry[] {
    return this.seats.get(zoneId) ?? [];
  }

  getRestSeat(
    zones: readonly Zone[],
    slotIndex: number,
  ): [number, number, number] {
    const restZone = zones.find((z) => z.archetype === 'rest');
    return computeRestSeatPosition(restZone?.cx ?? 0, restZone?.cz ?? 0, slotIndex);
  }
}
